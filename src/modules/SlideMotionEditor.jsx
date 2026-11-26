import React,{useEffect,useRef,useState} from 'react'
import {defaultCurve,motionString,parseMotion,svgPath} from './slide-motion.js'

export default function SlideMotionEditor({path=defaultCurve,onChange}) {
  const [draft,setDraft]=useState(path),[error,setError]=useState('')
  const [preview,setPreview]=useState(null)
  const drag=useRef(null)
  useEffect(()=>{setDraft(path);setError('')},[path])
  const segments=preview || parseMotion(path)
  if (!segments) return <p role="alert">无法识别路径。</p>
  const points=segments.flatMap(({values},segment)=>values.flatMap((x,i)=>i%2 ? [] : [{x:x*160,y:values[i+1]*90,segment,i}]))
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y)
  const minX=Math.min(-12,...xs)-5,minY=Math.min(-12,...ys)-5
  const bounds=drag.current?.bounds || [minX,minY,Math.max(68,...xs)-minX+5,Math.max(12,...ys)-minY+5]
  function adjusted(point,x,y) {
    return segments.map((s,index)=>index===point.segment?{...s,values:s.values.map((v,i)=>
      i===point.i?Math.max(-10,Math.min(10,x)):i===point.i+1?Math.max(-10,Math.min(10,y)):v)}:s)
  }
  function append(command) {
    const p=points.at(-1), closed=segments.at(-1).command==='Z'
    const x=closed?0:p.x/160,y=closed?0:p.y/90
    const values=command==='L'?[x+.1,y]:[x+.03,y-.08,x+.08,y-.08,x+.12,y]
    const next=motionString([...segments,{command,values}])
    if (parseMotion(next)) onChange(next)
  }
  function apply() {
    const next=parseMotion(draft)
    if (!next) {setError('路径须从 M 0 0 开始，以 E 结束。可使用 L 直线、C 曲线和 Z 闭合。');return}
    setError('');onChange(motionString(next))
  }
  return <div className="slide-path-editor">
    <svg viewBox={bounds.join(' ')} aria-label="运动路径控制点" onPointerMove={e=>{
      if (!drag.current) return
      const svg=e.currentTarget, pt=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse())
      setPreview(adjusted(drag.current.point,pt.x/160,pt.y/90))
    }} onPointerUp={()=>{if(preview) onChange(motionString(preview));drag.current=null;setPreview(null)}}
      onPointerCancel={()=>{drag.current=null;setPreview(null)}}>
      <path d={svgPath(segments,160,90)} fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke"/>
      {points.map((p,index)=>{
        const control=p.i+2<segments[p.segment].values.length
        return <circle key={index} cx={p.x} cy={p.y} r={1.7} className={control?'control':'anchor'}
          aria-label={(control?'曲线控制点 ':'路径节点 ')+index} tabIndex={index?0:undefined} role={index?'button':undefined}
          onPointerDown={e=>{if(!index || e.button!==0)return;e.preventDefault();drag.current={point:p,bounds};e.currentTarget.setPointerCapture(e.pointerId)}}
          onKeyDown={e=>{const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key]
            if(index && d){e.preventDefault();onChange(motionString(adjusted(p,p.x/160+d[0]*.01,p.y/90+d[1]*.01)))}}}/>
      })}
    </svg>
    <div><button type="button" onClick={()=>append('L')}>添加直线段</button><button type="button" onClick={()=>append('C')}>添加曲线段</button>
      <button type="button" disabled={segments.length<=2} onClick={()=>onChange(motionString(segments.slice(0,-1)))}>删除末段</button></div>
    <label>路径指令<input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')apply()}}/></label>
    <button type="button" onClick={apply}>应用路径</button>{error && <span role="alert">{error}</span>}
  </div>
}
