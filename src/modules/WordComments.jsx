import React, {useMemo,useState} from 'react'
import {Mark} from '@tiptap/core'
import {useEditorState} from '@tiptap/react'

export const WordComment=Mark.create({
  name:'wordComment',inclusive:false,excludes:'',
  addAttributes(){return {id:{default:''},text:{default:''},author:{default:''},date:{default:''}}},
  parseHTML(){return []},
  renderHTML(){return ['span',{'data-word-comment':'',class:'word-comment-anchor'},0]},
})

export default function WordComments({editor}) {
  const [text,setText]=useState(''),[author,setAuthor]=useState('本机用户')
  const state=useEditorState({editor,selector:({editor:e})=>({doc:e.state.doc,from:e.state.selection.from,to:e.state.selection.to}),
    equalityFn:(a,b)=>a.doc===b?.doc && a.from===b.from && a.to===b.to})
  const notes=useMemo(()=>{
    const list=new Map()
    state.doc.descendants((n,pos)=>{
      if(!n.isText) return
      for(const mark of n.marks.filter(m=>m.type.name==='wordComment')) {
        const previous=list.get(mark.attrs.id)
        if(previous) {previous.to=pos+n.nodeSize;previous.quote+=n.text}
        else list.set(mark.attrs.id,{mark,from:pos,to:pos+n.nodeSize,quote:n.text})
      }
    })
    return [...list.values()]
  },[state.doc])
  const selection=editor.state.selection
  const canAdd=!selection.empty && selection.$from.sameParent(selection.$to) && selection.$from.parent.isTextblock && !!state.doc.textBetween(state.from,state.to).trim()
  function add(e) {
    e.preventDefault()
    if(!canAdd || !text.trim()) return
    const mark=editor.schema.marks.wordComment.create({id:crypto.randomUUID(),text:text.trim(),author:author.trim()||'本机用户',date:new Date().toISOString()})
    editor.view.dispatch(editor.state.tr.addMark(state.from,state.to,mark))
    setText('')
  }
  return <section className="word-comments" aria-label="文档批注">
    <form onSubmit={add}><label>署名 <input aria-label="批注署名" value={author} maxLength={128} onChange={e=>setAuthor(e.target.value)}/></label>
      <textarea aria-label="批注内容" rows={2} maxLength={8192} value={text} onChange={e=>setText(e.target.value)} placeholder={canAdd?'写下批注':'在同一段落中选中要批注的文字'}/>
      <button disabled={!canAdd || !text.trim()}>添加批注</button></form>
    {notes.length>0 && <ul>{notes.map(({mark,from,to,quote})=><li key={mark.attrs.id}>
      <strong>{mark.attrs.author||'未署名'}</strong><q>{quote}</q><span>{mark.attrs.text}</span>
      <button onClick={()=>editor.chain().focus().setTextSelection({from,to}).scrollIntoView().run()}>定位</button>
      <button onClick={()=>editor.view.dispatch(editor.state.tr.removeMark(from,to,mark))}>删除批注</button></li>)}</ul>}
  </section>
}
