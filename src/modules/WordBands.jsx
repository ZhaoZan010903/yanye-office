import React, { useRef, useState } from 'react'
import { bandTypes, pageBand, pageTypes } from './word-bands.js'

export default function WordBands({layout,onChange}) {
  const [kind,setKind] = useState('header')
  const [type,setType] = useState('default')
  const input = useRef(null)
  const band = pageBand(layout,type,kind)
  const patch = fields => onChange({bands:{...layout.bands,[type]:{...layout.bands?.[type],[kind]:{...band,...fields}}}})
  function insert(field) {
    const start=input.current.selectionStart, end=input.current.selectionEnd
    patch({text:band.text.slice(0,start)+field+band.text.slice(end)})
    requestAnimationFrame(()=>{ input.current?.focus(); input.current?.setSelectionRange(start+field.length,start+field.length) })
  }
  return <section className="word-band-panel" aria-label="页眉页脚设置">
    <label>页种 <select value={type} onChange={e=>setType(e.target.value)}>
      {Object.entries(pageTypes).filter(([k])=>k==='default'||(k==='first'?layout.differentFirst:layout.differentEven))
        .map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label>位置 <select value={kind} onChange={e=>setKind(e.target.value)}>
      {Object.entries(bandTypes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <textarea ref={input} rows={2} aria-label={pageTypes[type]+bandTypes[kind]} value={band.text} onChange={e=>patch({text:e.target.value})}/>
    <label>对齐 <select aria-label="页眉页脚对齐" value={band.align} onChange={e=>patch({align:e.target.value})}>
      <option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
    <button onMouseDown={e=>e.preventDefault()} onClick={()=>insert('{{PAGE}}')}>插入页码</button>
    <button onMouseDown={e=>e.preventDefault()} onClick={()=>insert('{{NUMPAGES}}')}>插入总页数</button>
    {[['first','differentFirst','首页不同'],['even','differentEven','奇偶页不同']].map(([page,key,label])=>
      <label key={key}><input type="checkbox" checked={!!layout[key]} onChange={e=>{
        if (!e.target.checked && type===page) setType('default')
        onChange({[key]:e.target.checked})
      }}/>{label}</label>)}
  </section>
}
