// PowerPoint uses slide-relative coordinates. Sample lengths in screen pixels
// for even speed, then keep keyframes relative to the live slide size.
export const defaultCurve = 'M 0 0 C 0.08 -0.18 0.24 -0.18 0.32 0 E'

export function parseMotion(path) {
  if (typeof path !== 'string' || path.length > 16384) return null
  const tokens = path.trim().match(/[MLCZE]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)
  if (!tokens || tokens.join('') !== path.replace(/[\s,]+/g,'') || tokens.pop() !== 'E') return null
  const result = []
  const arity = {M:2,L:2,C:6,Z:0}
  for (let i=0; i<tokens.length;) {
    const command=tokens[i++]
    if (!Object.hasOwn(arity,command) || (command==='M')!==(result.length===0) || result.length>=256) return null
    const values=tokens.slice(i,i+arity[command]).map(Number)
    if (values.length!==arity[command] || values.some(n=>!Number.isFinite(n) || Math.abs(n)>10)) return null
    if (command==='M' && values.some(n=>n!==0)) return null
    result.push({command,values})
    i+=values.length
  }
  return result.length>1 ? result : null
}

export function motionString(segments) {
  return segments.map(({command,values})=>[command,...values.map(n=>Number(n.toFixed(7)))].join(' ')).join(' ')+' E'
}

export function svgPath(segments,width,height,offsetX=0,offsetY=0) {
  return segments.map(({command,values})=>[command,...values.map((v,index)=>
    index%2 ? v*height+offsetY : v*width+offsetX)].join(' ')).join(' ')
}

export function pathFrames(segments,width,height,origin) {
  const path=document.createElementNS('http://www.w3.org/2000/svg','path')
  path.setAttribute('d',svgPath(segments,width,height))
  const length=path.getTotalLength()
  const steps=Math.min(320,Math.max(1,Math.ceil(length/4)))
  const frames=Array.from({length:steps+1},(_,i)=>{
    const point=path.getPointAtLength(length*i/steps)
    const x=origin[0]+point.x/width, y=origin[1]+point.y/height
    return {translate:(x*100)+'cqw '+(y*100)+'cqh'}
  })
  const last=segments.at(-1)
  const [dx,dy]=last.command==='Z' ? [0,0] : last.values.slice(-2)
  return {frames,end:[origin[0]+dx,origin[1]+dy]}
}
