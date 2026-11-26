export const characterKeys = ['fontFace','fontSize','color','bold','italic','underline','strike']

export function characterStyle(value={}) {
  return Object.fromEntries(characterKeys.filter(k=>value[k]!=null).map(k=>[k,value[k]]))
}

function sameStyle(a,b) {
  return characterKeys.every(key=>a[key]===b[key])
}

export function addRun(runs, from,to,style) {
  if (from>=to || !Object.keys(style).length) return
  const last=runs.at(-1)
  if (last && last.to===from && sameStyle(last.style,style)) last.to=to
  else runs.push({from,to,style})
}

export function pieces(text,runs=[], offset=0) {
  const end=offset+text.length, parts=[]
  let pos=offset
  for (const run of runs) {
    if(run.to<=offset) continue
    if(run.from>=end) break
    const left=Math.max(pos,run.from),right=Math.min(run.to,end)
    if(left>pos)parts.push({text:text.slice(pos-offset,left-offset),style:{}})
    if(right>left)parts.push({text:text.slice(left-offset,right-offset),style:run.style})
    pos=Math.max(pos,right)
  }
  if(pos<end)parts.push({text:text.slice(pos-offset),style:{}})
  return parts
}

export function patchRuns(text,runs,from,to,patch) {
  const next=[]
  let pos=0
  for (const part of pieces(text,runs)) {
    const end=pos+part.text.length
    for (const [a,b] of [[pos,Math.min(from,end)],[Math.max(from,pos),Math.min(to,end)],[Math.max(to,pos),end]]) {
      if(b>a)addRun(next,a,b,a>=from && b<=to ? {...part.style,...patch} : part.style)
    }
    pos=end
  }
  return next
}

export function withoutOverrides(runs, patch) {
  const next=[]
  for(const {from,to,style} of runs || []) {
    const kept=Object.fromEntries(Object.entries(style).filter(([key])=>!Object.hasOwn(patch,key)))
    addRun(next,from,to,kept)
  }
  return next
}

export function runCss(style={}) {
  return {fontFamily:style.fontFace, fontSize:style.fontSize ? style.fontSize/9.6+'cqw' : undefined,
    color:style.color ? '#'+style.color : undefined, fontWeight:style.bold==null ? undefined : style.bold ? 700 : 400,
    fontStyle:style.italic==null ? undefined : style.italic ? 'italic' : 'normal',
    textDecoration:style.underline==null && style.strike==null ? undefined :
      [style.underline && 'underline',style.strike && 'line-through'].filter(Boolean).join(' ') || 'none'}
}

// Direct DrawingML properties on each character run are independent of the
// enclosing text box. Unspecified properties continue inheriting its defaults.
export function nativeRunStyle(pr) {
  if(!pr)return {}
  const child=(root,tag)=>Array.from(root?.children || []).find(el=>el.localName===tag)
  const result={}, font=child(pr,'latin')?.getAttribute('typeface') || child(pr,'ea')?.getAttribute('typeface')
  if(font && !font.startsWith('+'))result.fontFace=font
  const size=Number(pr.getAttribute('sz'))/100
  if(size>0)result.fontSize=size
  const color=child(child(pr,'solidFill'),'srgbClr')?.getAttribute('val')
  if(/^[A-Fa-f0-9]{6}$/.test(color))result.color=color.toUpperCase()
  for(const [key,name] of [['b','bold'],['i','italic']])if(pr.hasAttribute(key))result[name]=['1','true'].includes(pr.getAttribute(key))
  if(pr.hasAttribute('u'))result.underline=pr.getAttribute('u')!=='none'
  if(pr.hasAttribute('strike'))result.strike=pr.getAttribute('strike')!=='noStrike'
  return result
}

export function nativeTextRuns(shape) {
  const result=[]
  let pos=0
  for(const p of shape.getElementsByTagNameNS('*','p')) {
    const base=nativeRunStyle(Array.from(p.children).find(n=>n.localName==='pPr')?.getElementsByTagNameNS('*','defRPr')[0])
    for(const node of p.children) {
      if(node.localName==='br') {pos++;continue}
      if(!['r','fld'].includes(node.localName))continue
      const text=node.getElementsByTagNameNS('*','t')[0]?.textContent || ''
      const style={...base,...nativeRunStyle(node.getElementsByTagNameNS('*','rPr')[0])}
      addRun(result,pos,pos+text.length,style)
      pos+=text.length
    }
    pos++
  }
  return result
}
