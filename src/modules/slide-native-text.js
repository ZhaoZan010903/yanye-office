import {characterKeys,pieces} from './slide-runs.js'

export const A='http://schemas.openxmlformats.org/drawingml/2006/main'
export const P='http://schemas.openxmlformats.org/presentationml/2006/main'
export const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const elements=(el,ns,tag)=>Array.from(el?.getElementsByTagNameNS(ns,tag) || [])
export const children=(el,ns,tag)=>Array.from(el?.childNodes || []).filter(n=>n.namespaceURI===ns && n.localName===tag)
export const child=(el,ns,tag)=>children(el,ns,tag)[0]
export const make=(doc,ns,tag)=>doc.createElementNS(ns,(ns===A?'a:':'p:')+tag)
export function ensured(el,ns,tag,before=null){
  return child(el,ns,tag) || el.insertBefore(make(el.ownerDocument,ns,tag),before)
}
export function paint(pr,style) {
  if(style.fontSize!=null)pr.setAttribute('sz',Math.round(style.fontSize*100))
  for(const [name,attr] of [['bold','b'],['italic','i']])if(style[name]!=null)pr.setAttribute(attr,style[name]?'1':'0')
  if(style.underline!=null)pr.setAttribute('u',style.underline?'sng':'none')
  if(style.strike!=null)pr.setAttribute('strike',style.strike?'sngStrike':'noStrike')
  if(style.color) {
    for(const el of Array.from(pr.children))if(['solidFill','noFill','gradFill','pattFill','blipFill','grpFill'].includes(el.localName))el.remove()
    const fill=make(pr.ownerDocument,A,'solidFill'),rgb=make(pr.ownerDocument,A,'srgbClr')
    rgb.setAttribute('val',style.color);fill.append(rgb)
    const line=child(pr,A,'ln')
    pr.insertBefore(fill,line?line.nextSibling:pr.firstChild)
  }
  if(style.fontFace) {
    const before=Array.from(pr.children).find(el=>['sym','hlinkClick','hlinkMouseOver','rtl','extLst'].includes(el.localName)) || null
    for(const tag of ['latin','ea','cs'])ensured(pr,A,tag,before).setAttribute('typeface',style.fontFace)
  }
}
const textOf=p=>Array.from(p.children).map(n=>n.localName==='br'?'\n':elements(n,A,'t')[0]?.textContent || '').join('')
const changed=(a,b)=>Object.fromEntries(characterKeys.filter(key=>a[key]!=null && a[key]!==b[key]).map(key=>[key,a[key]]))

function alterRun(run, start, oldRuns, newRuns, before, after) {
  const t=child(run,A,'t')
  if(!t || !t.textContent.length)return
  const text=t.textContent,end=start+text.length
  const cuts=new Set([start,end])
  for(const r of [...oldRuns,...newRuns]) {
    if(r.from>start && r.from<end)cuts.add(r.from)
    if(r.to>start && r.to<end)cuts.add(r.to)
  }
  const points=Array.from(cuts).sort((a,b)=>a-b)
  const updates=[]
  for(let i=1;i<points.length;i++){
    const pos=points[i-1]
    const old={...before,...oldRuns.find(r=>r.from<=pos && pos<r.to)?.style}
    const current={...after,...newRuns.find(r=>r.from<=pos && pos<r.to)?.style}
    updates.push({text:text.slice(pos-start,points[i]-start),style:changed(current,old)})
  }
  if(!updates.some(u=>Object.keys(u.style).length))return
  // A native field or rich run may contain a hyperlink, language, kerning or
  // proofing flags. Cloning it preserves every property outside the edit.
  if(run.localName==='fld' && updates.length>1)throw Error('自动字段内部无法拆分字符格式，可选中整个字段。')
  for(const update of updates){
    const copy=run.cloneNode(true)
    child(copy,A,'t').textContent=update.text
    paint(ensured(copy,A,'rPr',copy.firstChild),update.style)
    run.parentNode.insertBefore(copy,run)
  }
  run.remove()
}

export function patchTextBody(shape, old, current) {
  const tx=child(shape,P,'txBody')
  if(!tx)return
  const paragraphs=children(tx,A,'p'),lines=current.text.split('\n')
  const oldText=paragraphs.map(textOf).join('\n')
  const before=old.format, after=current.format
  const sameText=oldText===current.text
  const oldRuns=old.runs || [],newRuns=current.runs || []
  let offset=0
  const source=sameText ? paragraphs.map(p=>({p,line:textOf(p)})) : lines.map((line,i)=>{
    const base=paragraphs[Math.min(i,paragraphs.length-1)]
    const p=base?.cloneNode(false) || make(tx.ownerDocument,A,'p')
    const props=child(base,A,'pPr')
    if(props)p.append(props.cloneNode(true))
    for(const part of pieces(line,newRuns,offset)){
      const run=make(tx.ownerDocument,A,'r'),pr=make(tx.ownerDocument,A,'rPr'),t=make(tx.ownerDocument,A,'t')
      paint(pr,{...after,...part.style});t.textContent=part.text;run.append(pr,t);p.append(run)
    }
    const mark=child(base,A,'endParaRPr')
    if(mark)p.append(mark.cloneNode(true))
    tx.insertBefore(p,paragraphs[0]);offset+=line.length+1
    return {p,line}
  })
  if(!sameText)paragraphs.forEach(p=>p.remove())
  offset=0
  for(const {p,line} of source){
    if(before.align!==after.align || before.lineSpacing!==after.lineSpacing){
      const pp=ensured(p,A,'pPr',p.firstChild)
      if(before.align!==after.align)pp.setAttribute('algn',({left:'l',right:'r',center:'ctr',justify:'just'})[after.align] || 'l')
      if(before.lineSpacing!==after.lineSpacing){
        child(pp,A,'lnSpc')?.remove()
        if(after.lineSpacing){
          const sp=ensured(pp,A,'lnSpc',pp.firstChild)
          ensured(sp,A,'spcPct').setAttribute('val',Math.round(after.lineSpacing*100000))
        }
      }
    }
    if(sameText) {
      let pos=offset
      for(const run of Array.from(p.children)){
        if(run.localName==='br'){pos++;continue}
        if(!['r','fld'].includes(run.localName))continue
        const len=child(run,A,'t')?.textContent.length || 0
        alterRun(run,pos,oldRuns,newRuns,before,after)
        pos+=len
      }
    }
    const markPatch=changed(after,before)
    if(Object.keys(markPatch).length)paint(ensured(p,A,'endParaRPr'),markPatch)
    offset+=line.length+1
  }
}
