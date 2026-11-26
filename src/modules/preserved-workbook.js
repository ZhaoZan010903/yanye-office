import JSZip from 'jszip'
import { inRect, isNumberText, LIMITS, location, parseRange, rangeName } from './spreadsheet.js'
import { verifyArchive } from './spreadsheet-xlsx.js'
import { attr, escapeXml as esc, mainNS, relations, scan, worksheets } from './workbook-package.js'

async function projectInfo(bytes) {
  const hash=await crypto.subtle.digest('SHA-256',bytes)
  const info={size:bytes.length,sha256:Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join(''),modules:[]}
  try {
    const {vbaProject}=await import('./vba-reader.js')
    const {name,modules,codepage,sourceState}=vbaProject(bytes)
    Object.assign(info,{name,modules,codepage,sourceState})
  } catch { info.unreadable=true }
  return info
}
async function projectPart(zip) {
  const link=(await relations(zip,'xl/workbook.xml')).find(r=>r.type.endsWith('/vbaProject'))
  return link && zip.file(link.part)
}
export async function openProjectReader(bytes) {
  verifyArchive(bytes)
  const file=await projectPart(await JSZip.loadAsync(bytes))
  if(!file) throw Error('原件中缺少 VBA 项目。')
  const {vbaProject}=await import('./vba-reader.js')
  return vbaProject(await file.async('uint8array'))
}
export async function preservedMetadata(bytes) {
  verifyArchive(bytes)
  const zip=await JSZip.loadAsync(bytes)
  const project=await projectPart(zip)
  const locks=Object.create(null)
  for(const ws of await worksheets(zip)) {
    const areas=await reservedAreas(zip,ws.part)
    let sheet=false
    scan(await zip.file(ws.part).async('string'),node=>{
      if(node.uri!==mainNS) return
      if(node.local==='sheetProtection' && !['0','false'].includes(attr(node,'sheet'))) sheet=true
      if(node.local==='f' && attr(node,'ref')) areas.push(parseRange(attr(node,'ref')))
      if(node.local==='c' && (attr(node,'cm') || attr(node,'vm'))) areas.push(parseRange(attr(node,'r')))
    })
    if(sheet || areas.length) locks[ws.name]={sheet,areas:areas.filter(Boolean)}
  }
  return {project:project ? await projectInfo(await project.async('uint8array')) : null,
    locks,signature:Object.keys(zip.files).some(path=>/^_xmlsignatures\//i.test(path))}
}

const xmlName = (prefix, name) => prefix ? prefix+':'+name : name
function cellXml(cell, ref, raw, prefix) {
  if(raw.length>LIMITS.text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(raw)) throw Error('输入内容超过工作表单元格允许的范围。')
  if(raw.startsWith('=')) throw Error('保留原包的编辑器支持修改常量，公式可以在原应用中编辑。')
  const key=xmlName(prefix,'c'), value=xmlName(prefix,'v'), inline=xmlName(prefix,'is'), text=xmlName(prefix,'t')
  if(cell?.formula || cell?.metadata) throw Error(ref+' 含公式或特殊数据，已保留原件。')
  const attributes=(cell?.attrs || [{name:'r',value:ref}]).filter(a=>a.name!=='t').map(a=>' '+a.name+'="'+esc(a.value)+'"').join('')
  const extras=cell?.extras.join('') || ''
  if(raw==='') return '<'+key+attributes+'>'+extras+'</'+key+'>'
  if(isNumberText(raw)) return '<'+key+attributes+'><'+value+'>'+esc(raw)+'</'+value+'>'+extras+'</'+key+'>'
  const contents=esc(raw.startsWith("'")?raw.slice(1):raw)
  return '<'+key+attributes+' t="inlineStr"><'+inline+'><'+text+' xml:space="preserve">'+contents+'</'+text+'></'+inline+'>'+extras+'</'+key+'>'
}
function replaceSpans(xml,spans) {
  let result='',pos=0
  for(const s of spans.sort((a,b)=>a.start-b.start || a.end-b.end)) {
    if(s.start<pos) throw Error('工作簿 XML 区域重叠。')
    result+=xml.slice(pos,s.start)+s.text; pos=s.end
  }
  return result+xml.slice(pos)
}

// Preserve all bytes outside edited rows and the worksheet dimension. Existing
// styles, code names, controls, VBA and their relationships stay in their parts.
function patchSheet(xml,changes,locked) {
  const edits=new Map(), rows=[], blocks=[...locked], spans=[]
  for(const [ref,raw] of Object.entries(changes)) {
    const point=location(ref)
    if(!point || point.row>=LIMITS.rows || point.col>=LIMITS.cols || typeof raw!=='string') throw Error('单元格坐标无效。')
    if(!edits.has(point.row)) edits.set(point.row,[])
    edits.get(point.row).push({row:point.row,col:point.col,ref,raw})
  }
  let row,cell,extra,depth=0,dimension,data,prefix='',protectedSheet=false
  scan(xml,(node,pos)=>{
    const start=xml.lastIndexOf('<',pos-1)
    depth++
    if(node.uri===mainNS) {
      if(node.local==='worksheet') prefix=node.prefix
      if(node.local==='dimension') dimension={start,end:pos,box:parseRange(attr(node,'ref')),key:node.name}
      if(node.local==='sheetProtection' && !['0','false'].includes(attr(node,'sheet'))) protectedSheet=true
      if(node.local==='sheetData') data={start,openEnd:pos,self:node.isSelfClosing}
      if(node.local==='row' && data && data.end===undefined) {
        row={index:Number(attr(node,'r'))-1,start,openEnd:pos,self:node.isSelfClosing,cells:[]}
        rows.push(row)
      }
      if(node.local==='c' && row && edits.has(row.index)) {
        cell={ref:attr(node,'r'),start,depth,attrs:Object.values(node.attributes),metadata:!!(attr(node,'cm') || attr(node,'vm')),extras:[]}
        row.cells.push(cell)
      }
      if(node.local==='f') {
        if(cell) cell.formula=true
        if(attr(node,'ref')) blocks.push(parseRange(attr(node,'ref')))
      }
      if(node.local==='mergeCell') {
        const box=parseRange(attr(node,'ref'))
        if(box) blocks.push({...box,allowFirst:true})
      }
    }
    if(cell && depth===cell.depth+1 && !(node.uri===mainNS && ['v','is','f'].includes(node.local))) extra={depth,start}
  },(node,pos)=>{
    if(extra && extra.depth===depth) {cell.extras.push(xml.slice(extra.start,pos)); extra=null}
    if(node.uri===mainNS) {
      if(node.local==='c' && cell) {cell.end=pos;cell=null}
      if(node.local==='row' && row) {row.end=pos;row.close=row.self?row.openEnd:xml.lastIndexOf('</',pos-1);row=null}
      if(node.local==='sheetData' && data) {data.end=pos;data.close=data.self?data.openEnd:xml.lastIndexOf('</',pos-1)}
    }
    depth--
  })
  if(protectedSheet) throw Error('工作表已启用保护，请在原应用中修改。')
  if(!data) throw Error('工作表缺少数据区。')
  const limit=dimension?.box || {top:Infinity,left:Infinity,bottom:0,right:0}, addedRows=new Map()
  const rowName=xmlName(prefix,'row'), dataName=xmlName(prefix,'sheetData')
  for(const [index,values] of [...edits].sort((a,b)=>a[0]-b[0])) {
    const existing=rows.find(r=>r.index===index)
    const updates=[], inserts=new Map()
    for(const v of values.sort((a,b)=>a.col-b.col)) {
      if(blocks.some(b=>b && inRect(b,v.row,v.col) && !(b.allowFirst && b.top===v.row && b.left===v.col))) throw Error(v.ref+' 属于公式、透视表或表头区域，已保留原件。')
      const original=existing?.cells.find(c=>c.ref===v.ref)
      if(!original && v.raw==='') continue
      const text=cellXml(original,v.ref,v.raw,prefix)
      if(original) updates.push({start:original.start,end:original.end,text})
      else {
        const after=existing?.cells.find(c=>location(c.ref).col>v.col)
        const at=after?.start ?? existing?.cells.at(-1)?.end ?? existing?.openEnd ?? 0
        inserts.set(at,(inserts.get(at)||'')+text)
      }
      limit.top=Math.min(limit.top,v.row);limit.left=Math.min(limit.left,v.col)
      limit.bottom=Math.max(limit.bottom,v.row);limit.right=Math.max(limit.right,v.col)
    }
    if(!updates.length && !inserts.size) continue
    if(existing && !existing.self) {
      spans.push(...updates,...Array.from(inserts,([at,text])=>({start:at,end:at,text})))
      const opening=xml.slice(existing.start,existing.openEnd)
      if(/\sspans=/.test(opening)) spans.push({start:existing.start,end:existing.openEnd,text:opening.replace(/\sspans=(?:"[^"]*"|'[^']*')/,'')})
    } else {
      const body=[...inserts.values()].join('')
      if(existing) spans.push({start:existing.start,end:existing.end,text:xml.slice(existing.start,existing.openEnd).replace(/\/>$/,'>')+body+'</'+rowName+'>'})
      else {
        const at=rows.find(r=>r.index>index)?.start ?? data.close
        addedRows.set(at,(addedRows.get(at)||'')+'<'+rowName+' r="'+(index+1)+'">'+body+'</'+rowName+'>')
      }
    }
  }
  if(data.self && addedRows.size) spans.push({start:data.start,end:data.end,text:xml.slice(data.start,data.openEnd).replace(/\/>$/,'>')+[...addedRows.values()].join('')+'</'+dataName+'>'})
  else spans.push(...Array.from(addedRows,([at,text])=>({start:at,end:at,text})))
  if(dimension && Number.isFinite(limit.top)) spans.push({start:dimension.start,end:dimension.end,text:'<'+dimension.key+' ref="'+rangeName(limit)+'"/>'})
  return replaceSpans(xml,spans)
}

async function reservedAreas(zip,partName) {
    const locked=[]
    for(const entry of await relations(zip,partName)) {
      const pivot=entry.type.endsWith('/pivotTable'), table=entry.type.endsWith('/table')
      if(!pivot && !table) continue
      const part=zip.file(entry.part)
      if(!part) throw Error('原件引用的工作表部件缺失。')
      scan(await part.async('string'),node=>{
        if(node.uri!==mainNS) return
        const box=parseRange(attr(node,'ref'))
        if(box && pivot && node.local==='location') locked.push(box)
        if(box && table && node.local==='table') {
          if(attr(node,'headerRowCount')!=='0') locked.push({...box,bottom:box.top})
          if(attr(node,'totalsRowCount')==='1') locked.push({...box,top:box.bottom})
        }
      })
    }
    return locked
}
function invalidateCalculation(xml) {
  let prefix='', tag, after, end
  const later=new Set(['oleSize','customWorkbookViews','pivotCaches','smartTagPr','smartTagTypes','webPublishing','fileRecoveryPr','webPublishObjects','extLst'])
  scan(xml,(node,pos)=>{
    if(node.uri!==mainNS) return
    if(node.local==='workbook') prefix=node.prefix
    if(node.local==='calcPr') tag={start:xml.lastIndexOf('<',pos-1),end:pos,source:node}
    if(after===undefined && later.has(node.local)) after=xml.lastIndexOf('<',pos-1)
  },(node,pos)=>{if(node.uri===mainNS && node.local==='workbook') end=xml.lastIndexOf('</',pos-1)})
  const attributes=tag ? Object.values(tag.source.attributes).filter(a=>!['fullCalcOnLoad','forceFullCalc','calcCompleted'].includes(a.name)).map(a=>' '+a.name+'="'+esc(a.value)+'"').join(''):''
  const key=xmlName(prefix,'calcPr'), at=tag?.start ?? after ?? end
  const text='<'+key+attributes+' fullCalcOnLoad="1" forceFullCalc="1" calcCompleted="0"'+(tag && !tag.source.isSelfClosing?'>':'/>')
  return replaceSpans(xml,[{start:at,end:tag?.end??at,text}])
}
export async function patchWorkbook(bytes,changes) {
  verifyArchive(bytes)
  if(!Object.values(changes).some(c=>Object.keys(c).length)) return bytes
  const zip=await JSZip.loadAsync(bytes)
  if(Object.keys(zip.files).some(p=>/^_xmlsignatures\//i.test(p))) throw Error('工作簿带有文档数字签名，修改会使签名失效。')
  const sheets=await worksheets(zip)
  for(const [name,edits] of Object.entries(changes)) {
    if(!Object.keys(edits).length) continue
    const ws=sheets.find(s=>s.name===name)
    if(!ws) throw Error('原工作簿缺少草稿中的工作表。')
    const locked=await reservedAreas(zip,ws.part)
    const original=await zip.file(ws.part).async('string')
    zip.file(ws.part,patchSheet(original,edits,locked))
  }
  zip.file('xl/workbook.xml',invalidateCalculation(await zip.file('xl/workbook.xml').async('string')))
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'})
}
