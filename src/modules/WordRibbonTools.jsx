import React,{useEffect,useState} from 'react'
import {Link,Omega,FilePlus2,MessageSquareText} from 'lucide-react'
import {RibbonGroup} from '../office/Ribbon'
import {WordBookmarkButton} from './WordBookmarks.jsx'

export function MarginInput({side,label,mm,onChange}) {
  const display=String(Number((mm/10).toFixed(2)))
  const [value,setValue]=useState(display)
  useEffect(()=>setValue(display),[display])
  function commit(){
    const n=Number(value)
    if(value.trim() && Number.isFinite(n) && n>=0 && n<=6.5) {if(n!==Number(display))onChange({[side]:n*10})}
    else setValue(display)
  }
  return <label>{label}<input type="number" aria-label={label+'页边距（厘米）'} min="0" max="6.5" step="0.01" value={value} onChange={e=>setValue(e.target.value)}
    onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape')setValue(display)}}/>cm</label>
}
export function WordInsertExtras({editor,setDialog,onComment}) {
  return <>
    <RibbonGroup label="页面">
      <button onMouseDown={e=>e.preventDefault()} onClick={()=>editor.chain().focus().insertContent([{type:'pageBreak'},{type:'paragraph'},{type:'pageBreak'}]).run()}><FilePlus2 size={16}/>空白页</button>
    </RibbonGroup>
    <RibbonGroup label="链接与符号">
      <WordBookmarkButton onClick={()=>setDialog({type:'bookmarks'})}/>
      <button onMouseDown={e=>e.preventDefault()} onClick={()=>{
        if(editor.isActive('link'))editor.commands.extendMarkRange('link')
        const {from,to}=editor.state.selection
        setDialog({type:'link',text:editor.state.doc.textBetween(from,to,' '),url:editor.getAttributes('link').href || ''})
      }}><Link size={16}/>超链接</button>
      <label title="插入符号"><Omega size={16}/><select aria-label="插入符号" value="" onChange={e=>editor.chain().focus().insertContent({type:'text',text:e.target.value}).run()}>
        <option value="" disabled>符号</option>{Array.from('©®™§¶℃°±×÷≤≥≠∞πΣ√≈→↔★○●✓').map(x=><option key={x}>{x}</option>)}</select></label>
      <button onClick={onComment}><MessageSquareText size={16}/>批注</button>
    </RibbonGroup>
  </>
}
export function WordLinkForm({editor,dialog,setDialog}) {
  const url=dialog.url.trim(),valid=/^(?:https?:\/\/[^\s/]+(?:[/?#][^\s]*)?|mailto:[^\s@]+@[^\s@]+)$/i.test(url)
  return <form className="word-reference-form" onSubmit={e=>{
    e.preventDefault()
    if(!valid)return
    const {from,to}=editor.state.selection
    const selected=editor.state.doc.textBetween(from,to,' '),text=dialog.text || url
    const chain=editor.chain().focus()
    if(!selected || selected!==text) chain.insertContent({type:'text',text,marks:[{type:'link',attrs:{href:url}}]})
    else chain.setLink({href:url})
    chain.run();setDialog(null)
  }}>
    <label>显示文字<input value={dialog.text} onChange={e=>setDialog({...dialog,text:e.target.value})}/></label>
    <label>链接地址<input autoFocus placeholder="https://" value={dialog.url} onChange={e=>setDialog({...dialog,url:e.target.value})}/></label>
    <button disabled={!valid}>应用链接</button>
    {editor.isActive('link') && <button type="button" onClick={()=>{editor.chain().focus().unsetLink().run();setDialog(null)}}>移除链接</button>}
    <button type="button" onClick={()=>{setDialog(null);editor.commands.focus()}}>取消</button>
  </form>
}
