import React,{useState} from 'react'
import {Node} from '@tiptap/core'
import {RibbonGroup} from '../office/Ribbon'
import {SquareDashed, Radical} from 'lucide-react'
import {defaultBox,canEditBoxText} from './word-text-box.js'
import {parseEquation,mathDom} from './word-equation.js'
import './word-objects.css'

const atom={inline:true,group:'inline',atom:true,selectable:true}
export const WordEquation=Node.create({...atom,name:'wordEquation',
  addAttributes(){return {source:{default:''},tree:{default:null},label:{default:''}}},
  renderHTML({node}){
    const a=node.attrs
    return ['span',{'data-word-equation':'',class:'word-equation',title:a.source??a.label,'aria-label':'公式 '+(a.source??a.label)},
      a.tree && a.source!=null?mathDom(a.tree):['span',{},a.label||'公式']]
  }})
export const WordTextBox=Node.create({...atom,name:'wordTextBox',
  addAttributes(){return Object.fromEntries(Object.entries({...defaultBox,native:null}).map(([k,v])=>[k,{default:v}]))},
  renderHTML({node}){
    const a=node.attrs
    const style={left:a.x+'pt',top:a.y+'pt',width:a.width+'pt',height:a.height+'pt',background:a.fill,'border-color':a.line}
    return ['span',{'data-word-textbox':'',class:'word-float-anchor'},['span',{class:'word-float-frame',role:'img','aria-label':'文本框 '+a.text,
      style:Object.entries(style).map(([k,v])=>k+':'+v).join(';')},a.text]]
  }})
export function WordObjectTools({open}){
  return <RibbonGroup label="文本与公式">
    <button onMouseDown={e=>e.preventDefault()} onClick={()=>open('wordTextBox')}><SquareDashed size={15}/>文本框</button>
    <button onMouseDown={e=>e.preventDefault()} onClick={()=>open('wordEquation')}><Radical size={15}/>公式</button>
  </RibbonGroup>
}
export function WordObjectPanel({editor,dialog,close}) {
  const box=dialog.type==='wordTextBox',orig=dialog.node?.attrs
  const [draft,set]=useState(()=>box?{...defaultBox,...orig}:{source:orig?.source??''})
  const [error,setError]=useState('')
  const change=(key,val)=>{set(data=>({...data,[key]:val}));setError('')}
  function submit(event){
    event.preventDefault()
    try{
      let attrs
      if(box){
        attrs={...draft}
        for(const key of ['x','y','width','height']){
          attrs[key]=Number(draft[key])
          if(draft[key]==='' || !Number.isFinite(attrs[key]) || (['width','height'].includes(key)?attrs[key]<1:attrs[key]<-1584) || attrs[key]>1584)throw Error('大小需为 1–1584 磅，偏移可为负值。')
        }
      }else attrs={source:draft.source,tree:parseEquation(draft.source),label:draft.source}
      const chain=editor.chain().focus()
      if(dialog.node){
        if(editor.state.doc.nodeAt(dialog.pos)!==dialog.node)throw Error('对象位置已经改变，请重新选择。')
        chain.setNodeSelection(dialog.pos).updateAttributes(dialog.type,attrs)
      }else chain.insertContent({type:dialog.type,attrs})
      if(!chain.run())throw Error('当前位置无法插入对象。')
      close()
    }catch(e){setError(e.message)}
  }
  return <form className="word-advanced-panel" aria-label={box?'文本框设置':'公式设置'} onSubmit={submit}>
    {box?<><label>文本框内容<textarea value={draft.text} readOnly={!canEditBoxText(orig?.native)} maxLength={32767} onChange={e=>change('text',e.target.value)} autoFocus/></label>
      {!canEditBoxText(orig?.native)&&<small>框内含有复杂内容，可调整位置、尺寸和颜色。</small>}
      {[['x','水平偏移'],['y','垂直偏移'],['width','宽度'],['height','高度']].map(([k,title])=><label key={k}>{title}<input type="number" step="any" aria-label={'文本框'+title} value={draft[k]} onChange={e=>change(k,e.target.value)}/>磅</label>)}
      <label>填充<input type="color" value={draft.fill} onChange={e=>change('fill',e.target.value)}/></label>
      <label>边框<input type="color" value={draft.line} onChange={e=>change('line',e.target.value)}/></label>
    </>:<><label>公式输入<input value={draft.source} autoFocus onChange={e=>change('source',e.target.value)} placeholder="例如 x^{2} + \frac{a}{b}"/></label>
      <select aria-label="插入公式结构" value="" onChange={e=>change('source',draft.source+e.target.value)}><option value="" disabled>公式结构</option>
        {Object.entries({'分数':'\\frac{a}{b}','根式':'\\sqrt{x}','上标':'x^{2}','下标':'x_{i}','上下标':'x_{i}^{2}'}).map(([name,v])=><option key={name} value={v}>{name}</option>)}</select>
      {orig?.source===null&&<small>此原生公式完整保留。输入新表达式将替换原公式。</small>}</>}
    <button type="submit">{dialog.node?'应用修改':box?'插入文本框':'插入公式'}</button>
    <button type="button" onClick={close}>取消</button>{error&&<span role="alert">{error}</span>}
  </form>
}
