import { defaultLayout, highlights, maxImageBytes, papers, validColor, validFont, wordValue, sectionLayout } from './word-model.js'
import { bandTypes, pageTypes, readBand } from './word-bands.js'
import {nativeSectionProperties} from './word-section-xml.js'
import {readComments} from './word-comments.js'
import {defaultTextFromStyles} from './word-default-fonts.js'
import {readNoteParts,readToc} from './word-references.js'
import {bookmarkAnchor,bookmarkNames,paragraphFields,validBookmark,joinReferenceResults} from './word-bookmarks.js'

import {namespaces,copyOfficeElement,textOf} from './word-native-object.js'
import {equationSource} from './word-equation.js'
import {readBox} from './word-text-box.js'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const child = (el, name) => [...(el?.children ?? [])].find(n=>n.localName === name)
const all = (el, name) => [...(el?.getElementsByTagNameNS('*',name) ?? [])]
const attr = (el, name) => el?.getAttributeNS(W,name) ?? el?.getAttribute('w:' + name)
const val = el => attr(el,'val')
const flag = el => el && !['0','false','none','off'].includes(val(el))
const bounded = (n,min,max,fallback) => Number.isFinite(n) && n>=min && n<=max ? n : fallback
const paragraph = () => ({ type:'paragraph' })
const structuralChanges=['pPrChange','rPrChange','tblPrChange','tblGridChange','cellIns','cellDel','cellMerge','trPrChange','tcPrChange','sectPrChange','moveFrom','moveTo']
const revisionTextNodes=new Set(['t','delText','tab','noBreakHyphen','rPr','commentReference'])
function editableRevision(el) {
  if(!['p','hyperlink'].includes(el.parentElement?.localName)) return false
  const children=[...el.children]
  const cursorBookmark=children.find(part=>part.localName==='bookmarkStart' && attr(part,'name')==='_GoBack')
  const cursorEnd=cursorBookmark && children.find(part=>part.localName==='bookmarkEnd' && attr(part,'id')===attr(cursorBookmark,'id'))
  return children.every(part=>
    (cursorEnd && (part===cursorBookmark || part===cursorEnd)) ||
    ['commentRangeStart','commentRangeEnd','proofErr'].includes(part.localName) ||
    (part.localName==='r' && [...part.children].every(child=>revisionTextNodes.has(child.localName))))
}

function revisionInfo(el) {
  return {kind:el.localName,id:'import-'+attr(el,'id'),author:attr(el,'author') || '',date:attr(el,'date') || ''}
}

function breakChange(p) {
  const properties=child(child(p,'pPr'),'rPr')
  return child(properties,'ins') || child(properties,'del')
}

// Revisions between ordinary, adjacent body paragraphs have two text runs
// and an independently tracked ending mark. Other containers and section
// boundaries still use the existing protection against destructive exports.
function editableBreak(el) {
  const p=el.parentElement?.parentElement?.parentElement
  const next=p?.nextElementSibling
  return p?.namespaceURI===W && p.localName==='p' && ['body','tc'].includes(p.parentElement?.localName) &&
    el===breakChange(p) && el.children.length===0 && next?.localName==='p' &&
    !child(child(p,'pPr'),'sectPr') && [p,next].every(n=>!child(child(n,'pPr'),'numPr') &&
      !flag(child(child(n,'pPr'),'pageBreakBefore')) && !all(n,'br').some(br=>attr(br,'type')==='page'))
}

function editablePreviousFormat(change) {
  const p=change.parentElement?.parentElement, prior=child(change,'pPr')
  if (!prior || p?.localName!=='p' || (!breakChange(p) && !breakChange(p.previousElementSibling))) return false
  const supported={jc:['val'],spacing:['before','after','line','lineRule'],ind:['left','firstLine','hanging','firstLineChars','hangingChars']}
  return [...prior.children].every(property=>Object.hasOwn(supported,property.localName) && !property.children.length &&
    [...property.attributes].every(a=>a.namespaceURI===W && supported[property.localName].includes(a.localName)) &&
    (property.localName!=='jc' || ['left','center','right','both','justify'].includes(val(property))) &&
    (property.localName!=='spacing' || !attr(property,'lineRule') || attr(property,'lineRule')==='auto'))
}

function inlineMarks(pr) {
  const marks = []
  for (const [tag,type] of [['b','bold'],['i','italic'],['u','underline'],['strike','strike']]) {
    if (flag(child(pr,tag))) marks.push({type})
  }
  const fontEl = child(pr,'rFonts')
  const font = attr(fontEl,'eastAsia')
  const latinFont = attr(fontEl,'ascii') || attr(fontEl,'hAnsi')
  const size = bounded(Number(val(child(pr,'sz')))/2,4,400,null)
  const color = '#' + (val(child(pr,'color')) ?? '')
  const highlight = val(child(pr,'highlight'))
  const script = val(child(pr,'vertAlign'))
  const attrs = {}
  if (validFont(font)) attrs.font = font
  if (validFont(latinFont) && latinFont !== font) attrs.latinFont = latinFont
  if (size) attrs.size = size
  if (validColor(color)) attrs.color = color
  if (Object.hasOwn(highlights,highlight)) attrs.highlight = highlight
  if (script === 'subscript' || script === 'superscript') attrs.script = script
  if (Object.keys(attrs).length) marks.push({type:'wordStyle',attrs})
  return marks
}

function organizeLists(entries, numbers) {
  const blocks = [], stack = []
  for (const {node, numId, level} of entries) {
    if (!numId || !['paragraph','heading'].includes(node.type)) { stack.length = 0; blocks.push(node); continue }
    const depth = Math.min(level, stack.length), spec = numbers.get(numId)?.(level)
    stack.length = Math.min(stack.length,depth+1)
    if (stack[depth]?.id !== numId) {
      const list = {type:spec?.ordered ? 'orderedList' : 'bulletList',content:[]}
      if (spec?.ordered) list.attrs = {start:spec.start}
      const dest = depth ? stack[depth-1].list.content.at(-1).content : blocks
      dest.push(list)
      stack[depth] = {id:numId,list}
    }
    stack[depth].list.content.push({type:'listItem',content:[{...node,type:'paragraph'}]})
  }
  return blocks
}

export async function readDocx(base64) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(base64,{base64:true})
  if (Object.keys(zip.files).length>8192) throw new Error('此 DOCX 包含过多部件。')
  let budget = 48*1024*1024
  const warnings = new Set()
  const cache = new Map()
  function bytes(path, limit) {
    const entry=zip.file(path)
    if (!entry) throw new Error('DOCX 缺少部件 ' + path)
    return new Promise((resolve,reject) => {
      const chunks=[], stream=entry.internalStream('uint8array')
      let size=0
      stream.on('data', chunk => {
        size+=chunk.length; budget-=chunk.length
        if (size>limit || budget<0) { stream.pause(); reject(new Error('DOCX 展开内容超出容量限制。')); return }
        chunks.push(chunk)
      }).on('error',reject).on('end',()=>{
        const out=new Uint8Array(size)
        let offset=0
        for (const c of chunks) { out.set(c,offset); offset+=c.length }
        resolve(out)
      }).resume()
    })
  }
  async function xml(path) {
    if (!zip.file(path)) return null
    const source=new TextDecoder().decode(await bytes(path,12*1024*1024))
    if (/<!DOCTYPE/i.test(source)) throw new Error('暂不支持包含外部实体声明的文档。')
    const result = new DOMParser().parseFromString(source,'application/xml')
    if (result.getElementsByTagName('parsererror').length) throw new Error('DOCX 部件格式无效。')
    return result.documentElement
  }
  const main = await xml('word/document.xml'), body=child(main,'body')
  if (!body) throw new Error('文件中未发现 Word 文档正文。')
  const background = child(main,'background')
  const pageColor = '#'+(attr(background,'color') || '')
  if (background && (background.children.length || attr(background,'themeColor'))) warnings.add('页面主题色、图片或纹理背景只预览基础底色')
  const relations = await xml('word/_rels/document.xml.rels')
  const targets = new Map(all(relations,'Relationship').map(r=>[r.getAttribute('Id'),r]))
  function partFor(kind,fallback) {
    const part=[...targets.values()].find(r=>r.getAttribute('Type')===R+'/'+kind)
    if (!part) return xml(fallback)
    if (part.getAttribute('TargetMode')==='External') return null
    const url=new URL(part.getAttribute('Target'),'https://local.invalid/word/document.xml')
    return url.origin==='https://local.invalid' ? xml(decodeURIComponent(url.pathname.slice(1))) : null
  }
  const noteParts=await readNoteParts(targets,xml)
  const bookmarkIndex=bookmarkNames(body)
  let anchorCount=0
  const commentsRel=[...targets.values()].find(r=>r.getAttribute('Type')===R+'/comments' && r.getAttribute('TargetMode')!=='External')
  let comments=new Map()
  if(commentsRel) {
    const url=new URL(commentsRel.getAttribute('Target'),'https://local.invalid/word/document.xml')
    if(url.origin==='https://local.invalid') comments=readComments(await xml(decodeURIComponent(url.pathname.slice(1))),message=>warnings.add(message))
  }
  const anchored=new Set()
  const numXml = await xml('word/numbering.xml'), numbers = new Map()
  const abstracts = new Map(all(numXml,'abstractNum').map(n=>[attr(n,'abstractNumId'),n]))
  for (const num of all(numXml,'num')) {
    const definition=abstracts.get(val(child(num,'abstractNumId')))
    numbers.set(attr(num,'numId'),level=>{
      const lvl=all(definition,'lvl').find(n=>Number(attr(n,'ilvl'))===level)
      const override=all(num,'lvlOverride').find(n=>Number(attr(n,'ilvl'))===level)
      const fmt=val(child(lvl,'numFmt'))
      if (fmt && !['decimal','bullet'].includes(fmt)) warnings.add('特殊编号按普通序列显示')
      return {ordered:fmt!=='bullet',start:Number(val(child(override,'startOverride')) || val(child(lvl,'start')) || 1)}
    })
  }
  const styles = await partFor('styles','word/styles.xml')
  const headings = new Map()
  for (const style of all(styles,'style')) {
    const level = val(child(child(style,'pPr'),'outlineLvl'))
    const named = /^(?:heading|标题)\s*([1-6])$/i.exec(val(child(style,'name')) || '')
    if (level!=null || named) headings.set(attr(style,'styleId'),bounded(level!=null?Number(level)+1:Number(named[1]),1,6,1))
  }
  async function image(drawing) {
    const rid = all(drawing,'blip')[0]?.getAttributeNS(R,'embed'), rel = targets.get(rid)
    const target=rel?.getAttribute('Target')
    if (!target || rel.getAttribute('TargetMode')==='External') { warnings.add('外链图片或绘图对象已略过'); return null }
    const resolved=new URL(target,'https://local.invalid/word/document.xml')
    const path=decodeURIComponent(resolved.pathname.slice(1))
    if (resolved.origin!=='https://local.invalid' || !/\.(?:jpe?g|png)$/i.test(path) || !zip.file(path)) { warnings.add('部分图形或图片格式已略过'); return null }
    if (!cache.has(path)) {
      const data=await bytes(path,maxImageBytes)
      const parts=[]
      for(let i=0;i<data.length;i+=8192) parts.push(String.fromCharCode(...data.subarray(i,i+8192)))
      cache.set(path,'data:image/' + (/\.png$/i.test(path)?'png':'jpeg') + ';base64,' + btoa(parts.join('')))
    }
    const extent=all(drawing,'extent')[0], desc=all(drawing,'docPr')[0]
    return {type:'image',attrs:{src:cache.get(path),alt:desc?.getAttribute('descr') || desc?.getAttribute('name') || '',
      width:bounded(Math.round(Number(extent?.getAttribute('cx'))/9525),1,10000,320),
      height:bounded(Math.round(Number(extent?.getAttribute('cy'))/9525),1,10000,180)}}
  }

  function paragraphFormat(pr) {
    const style=val(child(pr,'pStyle')) || ''
    const level=headings.get(style) || Number(/^Heading([1-6])$/i.exec(style)?.[1])
    const align=val(child(pr,'jc')), spacing=child(pr,'spacing')
    const attrs={}, indent=child(pr,'ind')
    for (const [el, property, key, divisor] of [[spacing,'before','spaceBefore',20],[spacing,'after','spaceAfter',20],
      [indent,'left','leftIndent',20],[indent,'firstLine','firstLinePt',20],[indent,'hanging','firstLinePt',-20],
      [indent,'firstLineChars','firstLineChars',100],[indent,'hangingChars','firstLineChars',-100]]) {
      const text = attr(el,property)
      if (text != null && /^-?\d+$/.test(text)) attrs[key] = Number(text) / divisor
    }
    if (level) attrs.level=level
    if (['left','right','center','both','justify'].includes(align)) attrs.align=align==='both'?'justify':align
    if (spacing && (attr(spacing,'lineRule') || 'auto')==='auto' && attr(spacing,'line')) attrs.lineSpacing=bounded(Number(attr(spacing,'line'))/240,0.5,5,1.25)
    return {type:level?'heading':'paragraph',attrs}
  }
  async function parseParagraph(p) {
    const fields=paragraphFields(p)
    if(fields.guarded)bookmarkIndex.protectedFields=true
    const ends=new Set(all(p,'commentRangeEnd').map(el=>attr(el,'id')))
    const activeComments=new Set()
    const pr=child(p,'pPr'), {type,attrs}=paragraphFormat(pr)
    const ending=breakChange(p), change=child(pr,'pPrChange')
    if (ending && editableBreak(ending)) attrs.breakRevision=revisionInfo(ending)
    if (change && editablePreviousFormat(change)) {
      attrs.paragraphFormatRevision={...revisionInfo(change),kind:'format',previous:paragraphFormat(child(change,'pPr'))}
    }
    const entries=[], num=child(pr,'numPr')
    const numId=val(child(num,'numId')), depth=bounded(Number(val(child(num,'ilvl'))),0,8,0)
    let inline=[]
    function flush() {
      entries.push({node:{type,attrs,content:inline},numId:numId==='0'?null:numId,level:depth})
      inline=[]
    }
    function pageBreak() { if (inline.length) flush(); entries.push({node:{type:'pageBreak'}}) }
    if (flag(child(pr,'pageBreakBefore'))) pageBreak()
    async function walk(el, marks=[], depth=0) {
      if (depth>48) throw new Error('文档元素嵌套过深。')
      for (const part of el.children) {
        const name=part.localName
        if(fields.replacements.has(part)){inline.push(fields.replacements.get(part));continue}
        if(fields.skip.has(part))continue
        if(name==='bookmarkStart' || name==='bookmarkEnd'){
          const marker=bookmarkAnchor(part,bookmarkIndex)
          if(marker){inline.push(marker);anchorCount++}
          continue
        }
        if(name==='commentRangeStart' || name==='commentRangeEnd') {
          const id=attr(part,'id')
          if(name==='commentRangeEnd') activeComments.delete(id)
          else if(ends.has(id) && comments.has(id)) activeComments.add(id)
          continue
        }
        if(name==='AlternateContent') {
          const choices=[...part.children]
          const supported=choices.find(c=>c.getElementsByTagNameNS(namespaces.wps,'txbx').length || c.getElementsByTagNameNS(namespaces.m,'oMath').length) || choices.find(c=>c.localName==='Fallback') || choices[0]
          if(supported)await walk(supported,marks,depth+1)
          continue
        }
        if(part.namespaceURI===namespaces.m && name==='oMathPara'){await walk(part,marks,depth+1);continue}
        if(part.namespaceURI===namespaces.m && name==='oMath') {
          try {const tree=copyOfficeElement(part);inline.push({type:'wordEquation',attrs:{tree,source:equationSource(tree),label:textOf(tree)}})}
          catch {bookmarkIndex.protectedFields=true;warnings.add('公式中有带关系的原生对象，需要保留原版式')}
          continue
        }
        if (name==='pPr' || name==='rPr') continue
        if (name==='r') { await walk(part,[...marks,...inlineMarks(child(part,'rPr'))],depth+1); continue }
        if (name==='t' || name==='delText' || name==='tab' || name==='noBreakHyphen') {
          const text=(name==='t' || name==='delText')?part.textContent:name==='tab'?'\t':'‑'
          if (text) {
            const annotated=[...marks,...[...activeComments].map(id=>{anchored.add(id);return {type:'wordComment',attrs:comments.get(id)}})]
            inline.push({type:'text',text,...(annotated.length?{marks:annotated}: {})})
          }
        } else if (name==='br' || name==='cr') {
          if (attr(part,'type')==='page') pageBreak()
          else inline.push({type:'hardBreak'})
        } else if (name==='drawing') {
          if(part.getElementsByTagNameNS(W,'txbxContent').length){
            try {const box=readBox(copyOfficeElement(part));if(!box)throw Error();inline.push({type:'wordTextBox',attrs:box})}
            catch {bookmarkIndex.protectedFields=true;warnings.add('此文本框含有图片或复杂扩展，需要保留原版式')}
          }else {const n=await image(part);if(n)inline.push(n)}
        } else if (name==='hyperlink') {
          const rel=targets.get(part.getAttributeNS(R,'id')), anchor=attr(part,'anchor'), href=rel?.getAttribute('Target') || (validBookmark(anchor)?'#'+anchor:null)
          await walk(part,href && /^(https?:\/\/|mailto:|#)/i.test(href)?[...marks,{type:'link',attrs:{href}}]:marks,depth+1)
        } else if (name==='ins' || name==='del') {
          const revision={type:'wordRevision',attrs:revisionInfo(part)}
          await walk(part,[...marks,revision],depth+1)
        } else if (['smartTag','sdt','sdtContent','fldSimple'].includes(name)) {
          warnings.add('域或内容控件已转换为正文')
          await walk(part,marks,depth+1)
        } else if (name==='footnoteReference' || name==='endnoteReference') {
          const note=noteParts.notes.get(name.replace('Reference','')+':'+attr(part,'id'))
          if(note) inline.push({type:'wordNote',attrs:note})
          else noteParts.protectedNotes=true
        } else if(name==='pict' && part.getElementsByTagNameNS(W,'txbxContent').length){
          bookmarkIndex.protectedFields=true
          warnings.add('旧版 VML 文本框需使用保留原版式模式写回')
        } else if (['del','pict','object','instrText'].includes(name)) warnings.add('部分审阅标记、域或嵌入对象已略过')
      }
    }
    await walk(p)
    if (inline.length || !entries.length) flush()
    return entries
  }
  async function blocks(container, depth=0) {
    if (depth>12) throw new Error('文档表格嵌套过深。')
    const entries=[]
    if(joinReferenceResults(container))bookmarkIndex.protectedFields=true
    const siblings=[...container.children]
    for (let i=0;i<siblings.length;i++) {
      const el=siblings[i]
      const toc=readToc(siblings,i)
      if(toc) {
        if(toc.protected) {bookmarkIndex.protectedFields=true;warnings.add('自定义目录或与正文共用段落的目录需要保留原版式')}
        for(const p of siblings.slice(i,toc.end+1)) {
          for(const el of all(p,'*').filter(n=>n.localName==='bookmarkStart' || n.localName==='bookmarkEnd')) {
            const side=(el.compareDocumentPosition(toc.first)&4)?'before':(el.compareDocumentPosition(toc.last)&2)?'after':null
            if(!side)continue
            const mark=bookmarkAnchor(el,bookmarkIndex)
            if(mark) {(toc.node.attrs[side]??=[]).push(mark.attrs);anchorCount++}
          }
        }
        entries.push({node:toc.node});i=toc.end
        const section=child(child(siblings[i],'pPr'),'sectPr')
        if(depth===0 && section)entries.push({node:{type:'sectionBreak',attrs:{layout:await readSection(section)}}})
        continue
      }
      if (el.localName==='p') {
        entries.push(...await parseParagraph(el))
        const section=child(child(el,'pPr'),'sectPr')
        if (depth===0 && section) entries.push({node:{type:'sectionBreak',attrs:{layout:await readSection(section)}}})
      }
      if (el.localName==='sdt' && child(el,'sdtContent')) {
        warnings.add('内容控件已转换为正文')
        for (const n of await blocks(child(el,'sdtContent'),depth+1)) entries.push({node:n})
      }
      if (el.localName!=='tbl') continue
      const rows=[], pending=new Map()
      for (const tr of [...el.children].filter(x=>x.localName==='tr')) {
        const cells=[], header=flag(child(child(tr,'trPr'),'tblHeader'))
        let col=0
        for (const tc of [...tr.children].filter(x=>x.localName==='tc')) {
          const props=child(tc,'tcPr'), span=bounded(Number(val(child(props,'gridSpan'))),1,500,1)
          const merge=child(props,'vMerge')
          if (merge && val(merge)!=='restart' && pending.has(col)) pending.get(col).attrs.rowspan++
          else {
            const inner=await blocks(tc,depth+1)
            const cell={type:header?'tableHeader':'tableCell',attrs:{colspan:span,rowspan:1},content:inner.length?inner:[paragraph()]}
            cells.push(cell)
            for(let i=0;i<span;i++) pending.delete(col+i)
            if (merge) pending.set(col,cell)
          }
          col+=span
        }
        rows.push({type:'tableRow',content:cells})
      }
      if (rows.length) entries.push({node:{type:'table',content:rows}})
    }
    return organizeLists(entries,numbers)
  }
  const settings=await partFor('settings','word/settings.xml')
  const mergeSettings=child(settings,'mailMerge')
  if(mergeSettings && ['dataSource','headerSource','odso','connectString','query'].some(tag=>child(mergeSettings,tag))){
    bookmarkIndex.protectedFields=true
    warnings.add('保留原版式模式会保留原件的邮件合并数据连接与查询')
  }
  const textDefaults=defaultTextFromStyles(styles,await partFor('theme','word/theme/theme1.xml'),settings)
  let bandRevisions=false
  async function readSection(section) {
    const layout={...defaultLayout}, size=child(section,'pgSz'), margins=child(section,'pgMar')
    layout.nativeSection=nativeSectionProperties(section,message=>warnings.add(message))
    const columns=child(section,'cols')
    if (columns) {
      layout.columns=Number(attr(columns,'num')) || 1
      if (attr(columns,'space')!=null) layout.columnGap=Number(attr(columns,'space'))*25.4/1440
      if ([...columns.children].some(el=>el.localName==='col')) warnings.add('不等宽分栏在工作区按等宽预览，原分栏宽度保留到 DOCX')
    }
    layout.start=val(child(section,'type')) || 'nextPage'
    const pageStart=attr(child(section,'pgNumType'),'start')
    if (pageStart!=null) layout.pageStart=Number(pageStart)
    if (size) {
      const width=Number(attr(size,'w')), height=Number(attr(size,'h')), short=Math.min(width,height), long=Math.max(width,height)
      layout.landscape=attr(size,'orient')==='landscape' || width>height
      const mm=[short,long].map(n=>n*25.4/1440)
      const match=Object.entries(papers).find(([,dims])=>dims.every((v,i)=>Math.abs(v-mm[i])<0.35))
      if (match) layout.paper=match[0]
      else if (mm.every(n=>n>=25 && n<=560)) {layout.paper='custom';layout.size=mm}
      else warnings.add('纸张尺寸超出可编辑范围')
    }
    for(const side of ['top','bottom','left','right']) if (attr(margins,side)!=null) layout[side]=Number(attr(margins,side))*25.4/1440
    if (flag(child(section,'titlePg'))) layout.differentFirst=true
    if (flag(child(settings,'evenAndOddHeaders'))) layout.differentEven=true
    for (const kind of Object.keys(bandTypes)) {
      const distance=attr(margins,kind)
      if (distance!=null) layout[kind+'Distance']=Number(distance)*25.4/1440
      for (const ref of all(section,kind+'Reference')) {
        const type=attr(ref,'type'), relation=targets.get(ref.getAttributeNS(R,'id'))
        if (!Object.hasOwn(pageTypes,type) || !relation || relation.getAttribute('TargetMode')==='External') continue
        const path=new URL(relation.getAttribute('Target'),'https://local.invalid/word/document.xml')
        const root=path.origin==='https://local.invalid' && await xml(decodeURIComponent(path.pathname.slice(1)))
        if (!root) {warnings.add('部分页眉页脚缺少引用部件');continue}
        if (['ins','del',...structuralChanges].some(tag=>all(root,tag).length)) bandRevisions=true
        const band=readBand(root,message=>warnings.add(message))
        layout.bands??={}
        layout.bands[type]??={}
        layout.bands[type][kind]=band
      }
    }
    return sectionLayout(layout)
  }
  const layout=await readSection(child(body,'sectPr'))
  const content=await blocks(body)
  if(anchorCount!==all(body,'bookmarkStart').length+all(body,'bookmarkEnd').length)bookmarkIndex.protectedFields=true
  if(bookmarkIndex.protectedFields)warnings.add('特殊域或书签需使用保留原版式模式写回')
  const protectedRevisions=bandRevisions || structuralChanges.some(tag=>all(body,tag).some(el=>tag!=='pPrChange' || !editablePreviousFormat(el))) ||
    [...all(body,'ins'),...all(body,'del')].some(el=>!editableRevision(el) && !editableBreak(el))
  if (protectedRevisions) {
    warnings.add('格式和结构修订需要保留原版式文件')
  }
  if(noteParts.protectedNotes) warnings.add('复杂注释需使用保留原版式模式写回')
  if (Object.keys(zip.files).some(p=>/word\/(?:charts|embeddings|vbaProject)/i.test(p))) warnings.add('图表或嵌入部件未参与转换')
  const extended=await xml('word/commentsExtended.xml')
  if(extended && all(extended,'commentEx').some(el=>[...el.attributes].some(a=>a.localName==='paraIdParent' || (a.localName==='done' && ['true','1'].includes(a.value))))) warnings.add('批注回复与解决状态需要保留原版式文件')
  if(comments.size!==anchored.size || all(body,'commentReference').some(el=>!anchored.has(attr(el,'id')))) warnings.add('跨段、点状或对象批注请使用保留原版式打开')
  return wordValue({layout,textDefaults,pageColor,protectedRevisions,protectedFields:bookmarkIndex.protectedFields,protectedNotes:noteParts.protectedNotes,trackChanges:Boolean(flag(child(settings,'trackRevisions'))),doc:{type:'doc',content:content.length?content:[paragraph()]},compatibility:[...warnings]})
}
