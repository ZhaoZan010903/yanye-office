import React, { useRef, useState } from 'react'
import { shapeKinds, slideShape, slideTextStyle } from './slides-model.js'
import SlideParagraphs from './SlideParagraphs.jsx'
import SlideRichText from './SlideRichText.jsx'

const polygons = {triangle:'50,0 100,100 0,100',diamond:'50,0 100,50 50,100 0,50',rightArrow:'0,25 60,25 60,0 100,50 60,100 60,75 0,75'}

export function SlideShape({ shape, selected, onSelect, onMove,split }) {
  const drag = useRef(null), [preview,setPreview] = useState(null)
  const box = preview || shape
  const style = { left:box.x*100+'%', top:box.y*100+'%', width:box.w*100+'%', height:box.h*100+'%',
    transform:'rotate('+box.rotation+'deg)', ...slideTextStyle({...box,align:box.shapeTextAlign || 'center'}) }
  function position(e) {
    const {x,y,width,height,screenX,screenY} = drag.current
    return slideShape({...shape,x:x+(e.clientX-screenX)/width,y:y+(e.clientY-screenY)/height})
  }
  const element = shape.kind==='ellipse' ? <ellipse cx="50" cy="50" rx="49.5" ry="49.5"/> :
    polygons[shape.kind] ? <polygon points={polygons[shape.kind]}/> : <rect x=".5" y=".5" width="99" height="99" rx={shape.kind==='roundRect'?12:0}/>
  return <div data-animation-target={shape.id} className={'slide-shape'+(selected?' selected':'')} style={style} tabIndex={onMove ? 0 : undefined}
    role={onMove?'button':undefined} aria-label={onMove?'选择形状 '+(shape.text || shapeKinds[shape.kind]):undefined}
    onFocus={onSelect} onKeyDown={e=>{
      if (!onMove) return
      const delta = e.shiftKey ? .05 : .005
      const offsets = {ArrowLeft:[-delta,0],ArrowRight:[delta,0],ArrowUp:[0,-delta],ArrowDown:[0,delta]}
      if (!offsets[e.key]) return
      e.preventDefault()
      onMove({x:shape.x+offsets[e.key][0],y:shape.y+offsets[e.key][1]})
    }} onPointerDown={e=>{
      if (!onMove || e.button!==0) return
      e.currentTarget.focus()
      const r = e.currentTarget.closest('.slides-page').getBoundingClientRect()
      drag.current = {x:shape.x,y:shape.y,width:r.width,height:r.height,screenX:e.clientX,screenY:e.clientY}
      e.currentTarget.setPointerCapture(e.pointerId)
    }} onPointerMove={e=>{if(drag.current)setPreview(position(e))}}
    onPointerUp={e=>{
      if (!drag.current) return
      const {x,y}=position(e)
      drag.current=null;setPreview(null)
      if(x!==shape.x || y!==shape.y) onMove({x,y})
    }} onLostPointerCapture={()=>{drag.current=null;setPreview(null)}}>
    <svg viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none" fill={'#'+shape.fill} stroke={'#'+shape.stroke}>{element}</svg>
    <span className="slide-shape-text"><SlideParagraphs text={shape.text} runs={shape.runs} split={split}/></span>
  </div>
}

export function ShapeProperties({ shape, shapes, select, edit, onSelection, reorder, duplicate, remove }) {
  const index=shapes.indexOf(shape)
  return <div className="slides-panel slides-box-properties" aria-label="形状属性">
    <select aria-label="选中形状" value={shape.id} onChange={e=>select(e.target.value)}>{shapes.map((s,i)=><option key={s.id} value={s.id}>{i+1}. {s.text || shapeKinds[s.kind]}</option>)}</select>
    <div className="slides-shape-text-field">文字<SlideRichText key={shape.id} className="slide-shape-label" label="形状文字" text={shape.text} runs={shape.runs}
      onSelection={onSelection} onEdit={edit}/></div>
    {Object.entries({fill:'填充',stroke:'轮廓',color:'字色'}).map(([key,label])=><label key={key}>{label}<input type="color" aria-label={'形状'+label}
      value={'#'+shape[key]} onChange={e=>edit({[key]:e.target.value.slice(1)})}/></label>)}
    {Object.entries({x:'左',y:'上',w:'宽',h:'高',rotation:'旋转'}).map(([key,label])=>{
      const factor=key==='rotation'?1:100, value=Number((shape[key]*factor).toFixed(2))
      return <label key={key}>{label}<input type="number" aria-label={'形状'+label} key={shape.id+':'+value} defaultValue={value}
        onBlur={e=>{if(Number.isFinite(e.target.valueAsNumber))edit({[key]:e.target.valueAsNumber/factor});e.target.value=String(value)}}
        onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/>{key==='rotation'?'°':'%'}</label>
    })}
    <button disabled={index===shapes.length-1} onClick={()=>reorder(1)}>上移一层</button><button disabled={!index} onClick={()=>reorder(-1)}>下移一层</button>
    <button onClick={duplicate}>复制形状</button><button onClick={remove}>删除形状</button><button onClick={()=>select(null)}>收起属性</button>
  </div>
}
