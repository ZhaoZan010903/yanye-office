import { defaultLayout, maxImageBytes, validColor, validFont, wordValue } from './word-model.js'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const child = (el, name) => [...(el?.children ?? [])].find(n=>n.localName === name)
const all = (el, name) => [...(el?.getElementsByTagNameNS('*',name) ?? [])]
const attr = (el, name) => el?.getAttributeNS(W,name) ?? el?.getAttribute('w:' + name)
const val = el => attr(el,'val')
const flag = el => el && !['0','false','none','off'].includes(val(el))
const bounded = (n,min,max,fallback) => Number.isFinite(n) && n>=min && n<=max ? n : fallback
const paragraph = () => ({ type:'paragraph' })

function inlineMarks(pr) {
  const marks = []
  for (const [tag,type] of [['b','bold'],['i','italic'],['u','underline'],['strike','strike']]) {
    if (flag(child(pr,tag))) marks.push({type})
  }
  const fontEl = child(pr,'rFonts')
  const font = attr(fontEl,'eastAsia') || attr(fontEl,'ascii') || attr(fontEl,'hAnsi')
  const size = bounded(Number(val(child(pr,'sz')))/2,4,400,null)
  const color = '#' + (val(child(pr,'color')) ?? '')
  if (validFont(font) || size || validColor(color)) marks.push({type:'wordStyle',attrs:{font:validFont(font)?font:null,size,color:validColor(color)?color:null}})
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
  const relations = await xml('word/_rels/document.xml.rels')
  const targets = new Map(all(relations,'Relationship').map(r=>[r.getAttribute('Id'),r]))
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
  const styles = await xml('word/styles.xml')
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

  async function parseParagraph(p) {
    const pr=child(p,'pPr'), style=val(child(pr,'pStyle')) || ''
    const level=headings.get(style) || Number(/^Heading([1-6])$/i.exec(style)?.[1])
    const align=val(child(pr,'jc')), spacing=child(pr,'spacing')
    const attrs={}
    if (level) attrs.level=level
    if (['left','right','center','both','justify'].includes(align)) attrs.align=align==='both'?'justify':align
    if (spacing && (attr(spacing,'lineRule') || 'auto')==='auto' && attr(spacing,'line')) attrs.lineSpacing=bounded(Number(attr(spacing,'line'))/240,0.5,5,1.25)
    const entries=[], num=child(pr,'numPr')
    const numId=val(child(num,'numId')), depth=bounded(Number(val(child(num,'ilvl'))),0,8,0)
    let inline=[]
    function flush() {
      entries.push({node:{type:level?'heading':'paragraph',attrs,content:inline},numId:numId==='0'?null:numId,level:depth})
      inline=[]
    }
    function pageBreak() { if (inline.length) flush(); entries.push({node:{type:'pageBreak'}}) }
    if (flag(child(pr,'pageBreakBefore'))) pageBreak()
    async function walk(el, marks=[], depth=0) {
      if (depth>48) throw new Error('文档元素嵌套过深。')
      for (const part of el.children) {
        const name=part.localName
        if (name==='pPr' || name==='rPr') continue
        if (name==='r') { await walk(part,[...marks,...inlineMarks(child(part,'rPr'))],depth+1); continue }
        if (name==='t' || name==='tab' || name==='noBreakHyphen') {
          const text=name==='t'?part.textContent:name==='tab'?'\t':'‑'
          if (text) inline.push({type:'text',text,...(marks.length?{marks}: {})})
        } else if (name==='br' || name==='cr') {
          if (attr(part,'type')==='page') pageBreak()
          else inline.push({type:'hardBreak'})
        } else if (name==='drawing') {
          const n=await image(part); if(n) inline.push(n)
        } else if (name==='hyperlink') {
          const rel=targets.get(part.getAttributeNS(R,'id')), href=rel?.getAttribute('Target')
          await walk(part,href && /^(https?:\/\/|mailto:)/i.test(href)?[...marks,{type:'link',attrs:{href}}]:marks,depth+1)
        } else if (['ins','smartTag','sdt','sdtContent','fldSimple'].includes(name)) {
          warnings.add('修订、域或内容控件已转换为正文')
          await walk(part,marks,depth+1)
        } else if (['del','pict','object','instrText','footnoteReference','endnoteReference'].includes(name)) warnings.add('部分审阅标记、域或嵌入对象已略过')
      }
    }
    await walk(p)
    if (inline.length || !entries.length) flush()
    return entries
  }
  async function blocks(container, depth=0) {
    if (depth>12) throw new Error('文档表格嵌套过深。')
    const entries=[]
    for (const el of container.children) {
      if (el.localName==='p') entries.push(...await parseParagraph(el))
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
  const layout={...defaultLayout}, sections=all(body,'sectPr'), section=sections.at(-1), size=child(section,'pgSz'), margins=child(section,'pgMar')
  if (size) {
    const width=Number(attr(size,'w')), height=Number(attr(size,'h')), short=Math.min(width,height), long=Math.max(width,height)
    layout.landscape=attr(size,'orient')==='landscape' || width>height
    layout.paper=Math.abs(short-12240) + Math.abs(long-15840) < Math.abs(short-11906) + Math.abs(long-16838) ? 'Letter':'A4'
    if (Math.min(Math.abs(short-12240)+Math.abs(long-15840), Math.abs(short-11906)+Math.abs(long-16838))>80) warnings.add('自定义纸张已套用接近的纸型')
  }
  for(const side of ['top','bottom','left','right']) if (attr(margins,side)!=null) layout[side]=Number(attr(margins,side))*25.4/1440
  if (sections.length>1) warnings.add('多节页面设置已统一')
  if (Object.keys(zip.files).some(p=>/word\/(?:headers?|footers?|comments|footnotes|endnotes|charts|embeddings|vbaProject)/i.test(p))) warnings.add('页眉页脚、批注、注释或嵌入部件未参与转换')
  const content=await blocks(body)
  return wordValue({layout,doc:{type:'doc',content:content.length?content:[paragraph()]},compatibility:[...warnings]})
}
