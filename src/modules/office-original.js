import JSZip from 'jszip'
import { verifyArchive } from './spreadsheet-xlsx.js'

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const sheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const nsXml = 'http://www.w3.org/XML/1998/namespace'
const objects = [
  [/^_xmlsignatures\//i,'数字签名'], [/\/vbaProject\.bin$/i,'宏项目'],
  [/\/charts\/chart\d+\.xml$/i,'内嵌图表'], [/\/diagrams\/data\d+\.xml$/i,'SmartArt 图形'],
  [/\/embeddings\/[^/]+$/i,'嵌入对象'], [/^(?:word|ppt)\/comments(?:\/[^/]+|\d*)\.xml$/i,'批注'],
  [/^xl\/pivotTables\/pivotTable\d+\.xml$/i,'数据透视表'], [/^xl\/externalLinks\/externalLink\d+\.xml$/i,'外部工作簿链接'],
  [/^word\/(endnotes|footnotes)\.xml$/i,'脚注或尾注'], [/^ppt\/media\/.*\.(?:mp4|wmv|mov|mp3|wav)$/i,'音视频'],
]
const types = {
  docx: {part:/^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i, ns:word, main:'word/document.xml'},
  xlsx: {part:/^xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml$/i, ns:sheet, main:'xl/workbook.xml'},
  pptx: {part:/^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/i, ns:drawing, main:'ppt/presentation.xml'},
}

async function openPackage(bytes, extension) {
  const { entries } = verifyArchive(bytes)
  const zip = await JSZip.loadAsync(bytes)
  if (Object.keys(zip.files).length !== entries) throw new Error('压缩包的部件名称重复，无法可靠地保留原件结构。')
  if (!zip.file(types[extension]?.main || '')) throw new Error('文件缺少相应的 Office 主文档部件。')
  const files = Object.values(zip.files).filter(file=>!file.dir)
  if (files.some(file=>file.unsafeOriginalName && file.unsafeOriginalName !== file.name)) throw new Error('文档包中有不规范的部件路径。')
  return zip
}

export async function inspectOriginal(bytes, extension) {
  const zip = await openPackage(bytes, extension)
  const names = Object.keys(zip.files)
  return objects.filter(([re])=>names.some(name=>re.test(name))).map(([,label])=>label)
}

function parseXml(xml) {
  if (/<!DOCTYPE\s/i.test(xml)) throw new Error('含 DTD 的文档部件无法用于原版式替换。')
  const doc = new DOMParser().parseFromString(xml,'application/xml')
  if (doc.getElementsByTagNameNS('*','parsererror').length) throw new Error('文档包含无法读取的 XML 部件。')
  return doc
}

async function xmlOf(file, budget) {
  const bytes = await new Promise((resolve,reject)=>{
    const stream=file.internalStream('uint8array')
    const chunks=[]
    let size=0
    stream.on('data',chunk=>{
      size+=chunk.length
      budget.remaining-=chunk.length
      if (budget.remaining<0) { stream.pause(); reject(new Error('原文档部件超过 64 MiB 解包上限。')); return }
      chunks.push(chunk)
    }).on('error',reject).on('end',()=>{
      const result=new Uint8Array(size)
      let at=0
      for (const chunk of chunks) { result.set(chunk,at); at+=chunk.length }
      resolve(result)
    }).resume()
  })
  // OOXML writers can choose UTF-8 or UTF-16 for individual parts.
  const encoding = bytes[0]===255 && bytes[1]===254 || bytes[0]===60 && bytes[1]===0 ? 'utf-16le'
    : bytes[0]===254 && bytes[1]===255 || bytes[0]===0 && bytes[1]===60 ? 'utf-16be' : 'utf-8'
  return new TextDecoder(encoding,{fatal:true}).decode(bytes)
}

function groupsIn(doc, extension) {
  const groups=[]
  const ns=types[extension].ns
  if (extension==='xlsx') {
    for (const key of ['si','is']) for (const container of doc.getElementsByTagNameNS(ns,key)) {
      const nodes=[]
      for (const child of container.children) {
        if (child.namespaceURI !== ns) continue
        if (child.localName==='t') nodes.push(child)
        if (child.localName==='r') nodes.push(...[...child.children].filter(node=>node.namespaceURI===ns && node.localName==='t'))
      }
      if (nodes.length) groups.push(nodes)
    }
    return groups
  }
  let fieldDepth=0
  for (const paragraph of doc.getElementsByTagNameNS(ns,'p')) {
    if (extension==='docx') {
      let ancestor=paragraph.parentElement
      while (ancestor && !(ancestor.namespaceURI===word && ['del','moveFrom'].includes(ancestor.localName))) ancestor=ancestor.parentElement
      if (ancestor) continue
    }
    let nodes=[]
    const flush=()=>{ if(nodes.length) groups.push(nodes); nodes=[] }
    function visit(parent) {
      for (const el of parent.children) {
        if (el.namespaceURI!==ns) { flush(); continue }
        if (el.localName==='hyperlink') { flush(); visit(el); flush(); continue }
        if (el.localName==='pPr' || el.localName==='proofErr' || el.localName.startsWith('bookmark')) continue
        if (el.localName!=='r') { flush(); continue }
        for (const part of el.children) {
          if (part.namespaceURI!==ns) { flush(); continue }
          if (part.localName==='rPr') continue
          if (part.localName==='fldChar') {
            flush()
            const type=part.getAttributeNS(word,'fldCharType')
            if (type==='begin') fieldDepth++
            if (type==='end') fieldDepth=Math.max(0,fieldDepth-1)
          } else if (part.localName==='t' && !fieldDepth) nodes.push(part)
          else flush()
        }
      }
    }
    visit(paragraph)
    flush()
  }
  return groups
}

function displayPart(name) {
  return name.replace('word/document.xml','正文').replace('xl/sharedStrings.xml','共享文字')
    .replace(/^word\/header(\d+)\.xml$/,'页眉 $1').replace(/^word\/footer(\d+)\.xml$/,'页脚 $1')
    .replace(/^xl\/worksheets\/sheet(\d+)\.xml$/,'工作表部件 $1')
    .replace(/^ppt\/slides\/slide(\d+)\.xml$/,'幻灯片部件 $1').replace(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/,'讲者备注部件 $1')
}

export async function readTextParts(bytes, extension, signal) {
  const zip=await openPackage(bytes,extension)
  if (Object.keys(zip.files).some(name=>objects[0][0].test(name))) throw new Error('此文件含数字签名。修改签名覆盖的文字会影响签名有效性。')
  const parts=[]
  const budget={remaining:64*1024*1024}
  for (const [name,file] of Object.entries(zip.files)) {
    if (!types[extension].part.test(name)) continue
    signal?.throwIfAborted()
    const xml=await xmlOf(file,budget)
    const texts=groupsIn(parseXml(xml),extension).map(nodes=>nodes.map(node=>node.textContent).join(''))
    parts.push({name,texts})
    if (globalThis.scheduler?.yield) await scheduler.yield()
  }
  return parts
}

export function previewMatches(parts, term) {
  const matches=[]
  let count=0
  if (!term) return {count,matches}
  for (const {name,texts} of parts) for (const text of texts) {
    const first=text.indexOf(term)
    if (first<0) continue
    for (let at=first; at>=0; at=text.indexOf(term,at+term.length)) count++
    if (matches.length<8) {
      const start=Math.max(0,first-25)
      matches.push({part:displayPart(name),text:text.slice(start,first+term.length+25)})
    }
  }
  return {count,matches}
}

// Split the original text once. Replacement text inherits the first run's
// format, while text after a multi-run match keeps its original format.
function replaceGroup(nodes, term, replacement) {
  const contents=nodes.map(node=>node.textContent)
  const text=contents.join('')
  const first=text.indexOf(term)
  if (first<0) return 0
  const output=nodes.map(()=>'')
  let index=0, offset=0, cursor=0, count=0
  function advance(until, copy) {
    while (cursor<until) {
      while (cursor===offset+contents[index].length) offset+=contents[index++].length
      const next=Math.min(until,offset+contents[index].length)
      if (copy) output[index]+=contents[index].slice(cursor-offset,next-offset)
      cursor=next
    }
  }
  for (let start=first; start>=0; start=text.indexOf(term,cursor)) {
    advance(start,true)
    while (cursor===offset+contents[index].length) offset+=contents[index++].length
    output[index]+=replacement
    advance(start+term.length,false)
    count++
  }
  advance(text.length,true)
  output.forEach((value,i)=>{
    if (value===contents[i]) return
    nodes[i].textContent=value
    if (/^\s|\s$/u.test(value)) nodes[i].setAttributeNS(nsXml,'xml:space','preserve')
  })
  return count
}

export async function replaceInOriginal(bytes, extension, parts, term, replacement) {
  if (!term || term===replacement || /[^\u0009\u000a\u000d\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(replacement)) throw new Error('请输入有效的查找文字和不同的替换文字。')
  const zip=await openPackage(bytes,extension)
  if (Object.keys(zip.files).some(name=>objects[0][0].test(name))) throw new Error('带签名的 Office 文件不能使用原版式替换。')
  const escapedBytes = text => new TextEncoder().encode(text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')).length
  const growth=Math.max(0,escapedBytes(replacement)-escapedBytes(term))
  if (growth && growth*previewMatches(parts,term).count + verifyArchive(bytes).total > 64*1024*1024) throw new Error('替换结果超过 64 MiB 解包上限，请缩短替换文字。')
  let count=0
  const budget={remaining:64*1024*1024}
  for (const {name,texts} of parts) {
    if (!texts.some(text=>text.includes(term))) continue
    const original=zip.file(name)
    const doc=parseXml(await xmlOf(original,budget))
    for (const group of groupsIn(doc,extension)) count+=replaceGroup(group,term,replacement)
    const xml=new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^?]*\?>/,'<?xml version="1.0" encoding="UTF-8"?>')
    zip.file(name,xml,{date:original.date,createFolders:false})
    if (globalThis.scheduler?.yield) await scheduler.yield()
  }
  if (!count) throw new Error('没有可替换的文字。')
  const result=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'})
  verifyArchive(result)
  return {count,bytes:result}
}
