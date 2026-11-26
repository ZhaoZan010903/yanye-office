import React,{useMemo,useState} from 'react'
import {Node} from '@tiptap/core'
import {useEditorState} from '@tiptap/react'
import {Bookmark,BookOpenCheck,RefreshCw} from 'lucide-react'
import {RibbonGroup} from '../office/Ribbon'
import {bookmarkRanges,bookmarkText,validBookmark} from './word-bookmarks.js'

export const WordBookmark=Node.create({
  name:'wordBookmark',inline:true,group:'inline',atom:true,selectable:false,
  addAttributes(){return {id:{default:''},name:{default:''},side:{default:'start'}}},
  renderHTML({node}){return ['span',{'data-word-bookmark':node.attrs.name,'data-side':node.attrs.side,'aria-hidden':'true'}]},
})
export const WordCrossRef=Node.create({
  name:'wordCrossRef',inline:true,group:'inline',atom:true,
  addAttributes(){return {name:{default:''},text:{default:''},link:{default:true}}},
  renderHTML({node}){return ['span',{'data-word-cross-ref':node.attrs.name,'data-link':String(node.attrs.link),title:'引用书签 '+node.attrs.name,class:'word-cross-ref'},node.attrs.text || '（空书签）']},
})
export const WordTextField=Node.create({
  name:'wordTextField',inline:true,group:'inline',atom:true,
  addAttributes(){return {code:{default:''},runs:{default:[]},text:{default:''},lock:{default:null},dirty:{default:null}}},
  renderHTML({node}){return ['span',{'data-word-text-field':node.attrs.code,title:node.attrs.code.trim(),class:'word-stored-field'},node.attrs.text]},
})
export function jumpBookmark(editor,range) {
  if(!range || range.start==null || range.end==null)return false
  return editor.chain().focus().setTextSelection({from:range.start+1,to:range.end}).scrollIntoView().run()
}
export function WordBookmarkButton({onClick}) {
  return <button onMouseDown={e=>e.preventDefault()} onClick={onClick}><Bookmark size={15}/>书签</button>
}
export function WordCrossRefTools({editor,onClick,report}) {
  const doc=useEditorState({editor,selector:({editor:e})=>e.state.doc,equalityFn:Object.is})
  const {ranges,references}=useMemo(()=>bookmarkRanges(doc),[doc])
  function update() {
    const tr=editor.state.tr
    for(const {pos,node} of references) {
      const range=ranges.find(r=>r.name.toLowerCase()===node.attrs.name.toLowerCase())
      const text=range && range.start!=null && range.end!=null?bookmarkText(doc,range):'错误！未找到引用源。'
      if(text!==node.attrs.text)tr.setNodeMarkup(pos,undefined,{...node.attrs,text})
    }
    editor.view.dispatch(tr)
    report('已更新 '+references.length+' 处书签引用。')
  }
  return <RibbonGroup label="交叉引用">
    <button disabled={!ranges.some(r=>!r.name.startsWith('_') && r.start!=null && r.end!=null)} onClick={onClick}><BookOpenCheck size={16}/>交叉引用</button>
    <button disabled={!references.length} onClick={update}><RefreshCw size={15}/>更新交叉引用</button>
  </RibbonGroup>
}
export function WordBookmarkPanel({editor,cross,close}) {
  const [name,setName]=useState(''),[chosen,setChosen]=useState(''),[withLink,setWithLink]=useState(true)
  const doc=useEditorState({editor,selector:({editor:e})=>e.state.doc,equalityFn:Object.is})
  const {ranges}=useMemo(()=>bookmarkRanges(doc),[doc])
  const visible=ranges.filter(r=>!r.name.startsWith('_'))
  const target=visible.find(r=>r.id===chosen) || visible[0]
  const complete=target?.start!=null && target?.end!=null
  const valid=validBookmark(name) && !name.startsWith('_') && !ranges.some(r=>r.name.toLowerCase()===name.toLowerCase())
  function add() {
    if(!valid)return
    const {from,to,$from,$to}=editor.state.selection
    if(!$from.parent.inlineContent || !$to.parent.inlineContent)return
    const id=crypto.randomUUID(),type=editor.schema.nodes.wordBookmark
    const tr=editor.state.tr.insert(to,type.create({id,name,side:'end'})).insert(from,type.create({id,name,side:'start'}))
    editor.view.dispatch(tr);setChosen(id);setName('')
  }
  function remove() {
    const tr=editor.state.tr
    for(const pos of [target.end,target.start].filter(Number.isInteger).sort((a,b)=>b-a))tr.delete(pos,pos+1)
    editor.view.dispatch(tr);setChosen('')
  }
  function insert() {
    if(!complete)return
    editor.chain().focus().insertContent({type:'wordCrossRef',attrs:{name:target.name,text:bookmarkText(doc,target),link:withLink}}).run()
    close()
  }
  return <section className="word-reference-form" aria-label={cross?'交叉引用设置':'书签管理'}>
    {!cross && <><label>书签名称<input autoFocus placeholder="名称" value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(!e.nativeEvent.isComposing && e.key==='Enter')add()}}/></label>
    <button disabled={!valid || !editor.state.selection.$from.parent.inlineContent || !editor.state.selection.$to.parent.inlineContent} onClick={add}>添加书签</button></>}
    <label>文档书签<select value={target?.id || ''} onChange={e=>setChosen(e.target.value)}>
      {!visible.length && <option value="">暂无书签</option>}
      {visible.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    {cross?<><label><input type="checkbox" checked={withLink} onChange={e=>setWithLink(e.target.checked)}/>插入为超链接</label>
      <button disabled={!complete} onClick={insert}>插入书签文字引用</button></>:
      <><button disabled={!complete} onClick={()=>jumpBookmark(editor,target)}>定位书签</button><button disabled={!target} onClick={remove}>删除书签</button></>}
    <button onClick={close}>关闭</button>
  </section>
}
