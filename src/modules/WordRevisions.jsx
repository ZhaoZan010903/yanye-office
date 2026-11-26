import React, {useMemo} from 'react'
import {useEditorState} from '@tiptap/react'
import {revisions,resolveRevisions} from './word-revisions.js'

export default function WordRevisions({editor, enabled, toggle, author, setAuthor}) {
  const doc=useEditorState({editor,selector:({editor})=>editor.state.doc,equalityFn:Object.is})
  const list=useMemo(()=>revisions(doc),[doc])
  return <section className="word-revisions" aria-label="文字修订">
    <label><input type="checkbox" checked={enabled} onChange={e=>toggle(e.target.checked)}/>记录文字修订</label>
    <label>修订者 <input aria-label="修订者" value={author} maxLength={128} onChange={e=>setAuthor(e.target.value)}/></label>
    {list.length>0 && <><button onClick={()=>resolveRevisions(editor,list,true)}>接受全部修订</button>
      <button onClick={()=>resolveRevisions(editor,list,false)}>拒绝全部修订</button>
      <ol>{list.map(item=><li key={item.id}>
        <button title="定位修订" onClick={()=>editor.chain().setTextSelection(item.spans[0].from).scrollIntoView().run()}>{item.author} · {item.kind==='ins'?'插入':'删除'} {item.text.slice(0,60)}</button>
        <button onClick={()=>resolveRevisions(editor,[item],true)}>接受</button>
        <button onClick={()=>resolveRevisions(editor,[item],false)}>拒绝</button>
      </li>)}</ol></>}
  </section>
}
