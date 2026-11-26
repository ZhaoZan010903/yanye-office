import React,{useState} from 'react'
import {Plus,Trash2} from 'lucide-react'
import {slideTextStyle} from './slides-model.js'

export function MasterLabels({master}) {
  return master?.labels.map(label=><div key={label.id} className="slides-text slides-master-label"
    style={{left:label.x*100+'%',top:label.y*100+'%',width:label.w*100+'%',height:label.h*100+'%',...slideTextStyle(label)}}>{label.text}</div>)
}

export default function SlideMasterEditor({masters,activeId,setActiveId,update,theme,ratio,close}) {
  const master=masters.find(m=>m.id===activeId) || masters[0]
  const [labelId,selectLabel]=useState(null)
  const label=master.labels.find(item=>item.id===labelId) || master.labels[0]
  const patch=values=>update({...master,...values,edited:true})
  const editLabel=values=>patch({labels:master.labels.map(l=>l.id===label.id?{...l,...values}:l)})
  function add(){
    const id=crypto.randomUUID()
    patch({labels:[...master.labels,{id,text:'母版文字',x:.06,y:.85,w:.84,h:.1,fontFace:'Microsoft YaHei',fontSize:18,color:theme.ink}]})
    selectLabel(id)
  }
  return <div className="slides-master-editor" aria-label="幻灯片母版编辑器">
    <aside aria-label="母版属性">
      <label>母版<select aria-label="选择母版" value={master.id} onChange={e=>{setActiveId(e.target.value);selectLabel(null)}}>
        {masters.map((m,i)=><option key={m.id} value={m.id}>{i+1}. {m.name}</option>)}
      </select></label>
      <label>名称<input aria-label="母版名称" value={master.name} onChange={e=>patch({name:e.target.value})}/></label>
      <label>背景<input aria-label="母版背景色" type="color" value={'#'+(master.background || theme.background)} onChange={e=>patch({background:e.target.value.slice(1).toUpperCase()})}/></label>
      <button onClick={add}><Plus size={15}/>添加母版文本框</button>
      {label && <>
        <select aria-label="选择母版文本框" value={label.id} onChange={e=>selectLabel(e.target.value)}>
          {master.labels.map((l,i)=><option key={l.id} value={l.id}>{i+1}. {l.text.slice(0,20)}</option>)}
        </select>
        <label>文字<textarea aria-label="母版文本" value={label.text} onChange={e=>editLabel({text:e.target.value})}/></label>
        <label>字体<input aria-label="母版文本字体" value={label.fontFace} onChange={e=>editLabel({fontFace:e.target.value})}/></label>
        <label>字号<input aria-label="母版文本字号" type="number" min="6" max="144" value={label.fontSize}
          onChange={e=>{if(e.target.value && e.target.validity.valid)editLabel({fontSize:e.target.valueAsNumber})}}/></label>
        <label>字色<input aria-label="母版文本颜色" type="color" value={'#'+label.color} onChange={e=>editLabel({color:e.target.value.slice(1).toUpperCase()})}/></label>
        {Object.entries({x:'左',y:'上',w:'宽',h:'高'}).map(([key,name])=><label key={key}>{name}（%）
          <input aria-label={'母版文本'+name} type="number" min={key==='w'||key==='h'?0.1:0} max="100" step="0.1"
            value={+(label[key]*100).toFixed(1)} onChange={e=>{if(e.target.value && e.target.validity.valid)editLabel({[key]:e.target.valueAsNumber/100})}}/></label>)}
        <button onClick={()=>patch({labels:master.labels.filter(l=>l.id!==label.id)})}><Trash2 size={15}/>删除母版文本框</button>
      </>}
      <button onClick={close}>关闭母版视图</button>
    </aside>
    <div className="slides-master-preview"><div className="slides-page" aria-label="母版预览"
      style={{aspectRatio:ratio,'--slide-paper':'#'+(master.background || theme.background)}}><MasterLabels master={master}/></div></div>
  </div>
}
