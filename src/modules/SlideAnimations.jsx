import React,{forwardRef,useImperativeHandle,useLayoutEffect,useRef,useState} from 'react'
import {animationNames,effectGroups,slideTargets,triggerNames} from './slide-animations.js'

export function AnimationPanel({slide,onChange}) {
  const targets=slideTargets(slide), effects=slide.animations||[]
  const [picked,setPicked]=useState('title')
  const target=targets.some(([key])=>key===picked)?picked:'title'
  const locked=slide.nativeTiming && !slide.nativeTiming.editable
  function update(index,patch) { onChange(effects.map((effect,i)=>i===index?{...effect,...patch}:effect)) }
  function move(index,step) {
    const next=effects.slice(), where=index+step
    const moved=next.splice(index,1)[0]
    next.splice(where,0,moved)
    onChange(next)
  }
  return <section className="slide-animations" aria-label="对象动画">
    {locked && <p>此页含组合、路径或其他复杂时间线。可识别的效果可在放映时预览；原始时间线随对象保留。</p>}
    <fieldset disabled={locked}><label>动画对象<select value={target} onChange={e=>setPicked(e.target.value)}>{targets.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <button onClick={()=>onChange([...effects,{id:crypto.randomUUID(),target,effect:'fade',trigger:'click',duration:500,delay:0,direction:'down',degrees:360}])}>添加动画</button>
      {effects.length>0 && <ol>{effects.map((item,index)=><li key={item.id}>
        <span>{targets.find(([id])=>id===item.target)?.[1]}</span>
        <select aria-label={'动画效果 '+(index+1)} value={item.effect} onChange={e=>update(index,{effect:e.target.value})}>{Object.entries(animationNames).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
        <select aria-label={'动画触发 '+(index+1)} value={item.trigger} onChange={e=>update(index,{trigger:e.target.value})}>{Object.entries(triggerNames).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
        {['duration','delay'].map(property=><label key={property}>{property==='duration'?'持续':'延迟'}（秒）<input aria-label={(property==='duration'?'持续秒数 ':'延迟秒数 ')+(index+1)}
          key={item[property]} type="number" min={property==='duration'?0.001:0} max="86400" step="any" defaultValue={item[property]/1000} onBlur={e=>{if(e.target.checkValidity() && Number.isFinite(e.target.valueAsNumber))update(index,{[property]:Math.round(e.target.valueAsNumber*1000)});else e.target.value=item[property]/1000}}/></label>)}
        {['wipe','fly'].includes(item.effect) && <select aria-label="动画方向" value={item.direction} onChange={e=>update(index,{direction:e.target.value})}>{Object.entries({down:'向下',up:'向上',left:'向左',right:'向右'}).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>}
        {item.effect==='motion' && ['dx','dy'].map((key,axis)=><label key={key}>{axis?'垂直':'水平'}位移（%）<input
          aria-label={(axis?'垂直':'水平')+'位移百分比'} type="number" step="any" min="-1000" max="1000" key={item[key]} defaultValue={Math.round((item[key]??(axis?0:.25))*10000)/100}
          onBlur={e=>{if(e.target.checkValidity()&&Number.isFinite(e.target.valueAsNumber))update(index,{[key]:e.target.valueAsNumber/100})}}/></label>)}
        <button disabled={index===0} onClick={()=>move(index,-1)}>上移</button><button disabled={index===effects.length-1} onClick={()=>move(index,1)}>下移</button>
        <button onClick={()=>onChange(effects.filter((_,i)=>i!==index))}>移除动画</button>
      </li>)}</ol>}
    </fieldset>
  </section>
}

function frames(effect) {
  if(effect.effect==='fade') return [{opacity:0},{opacity:1}]
  if(effect.effect==='spin') return [{rotate:'0deg'},{rotate:(effect.degrees || 360)+'deg'}]
  if(effect.effect==='fly') {
    const from={down:'0 100cqw',up:'0 -100cqw',left:'-100cqw 0',right:'100cqw 0'}
    return [{translate:from[effect.direction]||from.down},{translate:'0 0'}]
  }
  if(effect.effect==='wipe') {
    const from={down:'0 0 100% 0',up:'100% 0 0 0',left:'0 0 0 100%',right:'0 100% 0 0'}
    return [{clipPath:'inset('+(from[effect.direction]||from.down)+')'},{clipPath:'inset(0)'}]
  }
  return null
}

export const AnimatedPage=forwardRef(function AnimatedPage({slide,children},ref) {
  const host=useRef(null), advance=useRef(()=>false)
  useImperativeHandle(ref,()=>({advance:()=>advance.current()}),[])
  useLayoutEffect(()=>{
    const elements=new Map([...host.current.querySelectorAll('[data-animation-target]')].map(el=>[el.dataset.animationTarget,el]))
    const effects=slide.animations || [], groups=effectGroups(effects)
    const seen=new Set()
    for(const effect of effects) {
      if(!seen.has(effect.target) && !['spin','motion'].includes(effect.effect) && elements.has(effect.target)) elements.get(effect.target).style.visibility='hidden'
      seen.add(effect.target)
    }
    let index=0
    const endpoints=new Map()
    const timers=[],animations=[],finish=[]
    function finishGroup() {
      for(const timer of timers.splice(0)) clearTimeout(timer)
      for(const action of finish.splice(0)) action()
      for(const animation of animations.splice(0)) animation.cancel()
    }
    function play() {
      finishGroup()
      const group=groups[index++]
      if(!group) return false
      for(const {effect,start} of group.items) {
        const el=elements.get(effect.target)
        if(!el) continue
        const reveal=()=>{el.style.visibility='visible'}
        let path=null, settle=reveal
        if (effect.effect==='motion') {
          const box=host.current.querySelector('.slides-page').getBoundingClientRect()
          const [x,y]=endpoints.get(effect.target)||[0,0]
          const next=[x+(effect.dx??.25)*box.width,y+(effect.dy??0)*box.height]
          const end=next[0]+'px '+next[1]+'px'
          path=[{translate:x+'px '+y+'px'},{translate:end}]
          endpoints.set(effect.target,next)
          settle=()=>{reveal();el.style.translate=end}
        }
        finish.push(settle)
        const go=()=>{
          reveal()
          const sequence=path || frames(effect)
          if(sequence && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const easing=effect.accel && effect.decel?'ease-in-out':effect.accel?'ease-in':effect.decel?'ease-out':'linear'
            const animation=el.animate(sequence,{duration:effect.duration,easing})
            animation.onfinish=settle
            animations.push(animation)
          } else settle()
        }
        if(start>0) timers.push(setTimeout(go,start))
        else go()
      }
      return true
    }
    advance.current=play
    if(groups[0]?.automatic) play()
    return ()=>{finishGroup();advance.current=()=>false}
  },[slide])
  return <div ref={host}>{children}</div>
})
