import React, { useEffect, useMemo, useRef, useState } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import { markdownMatches } from './markdown-search.js'

export default function MarkdownFind({ editor, sourceRef, source, replacing, close }) {
  const [query,setQuery] = useState('')
  const [replacement,setReplacement] = useState('')
  const [sensitive,setSensitive] = useState(false)
  const [index,setIndex] = useState(-1)
  const field=useRef(null)
  const doc=editor?.state.doc
  const matches=useMemo(()=>markdownMatches(source ?? doc,query,sensitive),[source,doc,query,sensitive])
  const current=Math.min(index,matches.length-1)
  useEffect(()=>{ field.current?.focus(); field.current?.select() },[replacing])
  function select(n) {
    if (!matches.length) return
    const i=(n+matches.length)%matches.length, {from,to}=matches[i]
    setIndex(i)
    if (source !== null) {
      sourceRef.current?.selectSource(from,to)
    } else {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc,from,to)).scrollIntoView())
      editor.view.focus()
    }
  }
  function replace(all) {
    if (!matches.length || (all && matches.length>10000)) return
    const selected=all ? matches : [matches[Math.max(0,current)]]
    if (source !== null) {
      sourceRef.current?.replaceRanges(selected,replacement)
    } else {
      const tr=editor.state.tr
      for (let i=selected.length-1; i>=0; i--) {
        const {from,to}=selected[i]
        tr.insertText(replacement,from,to)
      }
      editor.view.dispatch(tr.scrollIntoView())
      editor.view.focus()
    }
  }
  function step(backward) {
    select(backward ? (current<0 ? matches.length-1 : current-1) : current+1)
  }
  useEffect(()=>{
    const onKey=e=>{
      if(e.key==='F3' && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault();step(e.shiftKey) }
    }
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  })
  return <div className="md-find" role="search" aria-label="文内查找与替换"
    onKeyDown={e=>{ if(e.key==='Escape'){ e.preventDefault(); close() } }}>
    <input aria-label="查找文字" placeholder="查找文字" ref={field} value={query} onChange={e=>{setQuery(e.target.value);setIndex(-1)}}
      onKeyDown={e=>{if(e.key==='Enter' && !e.nativeEvent.isComposing){e.preventDefault();step(e.shiftKey)}}}/>
    <button disabled={!matches.length} onClick={()=>step(true)}>上一处</button>
    <button disabled={!matches.length} onClick={()=>step(false)}>下一处</button>
    <label><input type="checkbox" checked={sensitive} onChange={e=>{setSensitive(e.target.checked);setIndex(-1)}}/>区分大小写</label>
    {replacing && <><input aria-label="替换文字" placeholder="替换为" value={replacement} onChange={e=>setReplacement(e.target.value)} />
      <button disabled={!matches.length} onClick={()=>replace(false)}>替换当前</button>
      <button disabled={!matches.length || matches.length>10000} onClick={()=>replace(true)}>全部替换</button></>}
    <span role="status">{query ? matches.length>10000 ? '超过 10,000 处，请缩小范围' : matches.length ? (current<0 ? matches.length+' 处' : (current+1)+' / '+matches.length) : '没有匹配' : ''}</span>
    <button onClick={close}>关闭查找</button>
  </div>
}
