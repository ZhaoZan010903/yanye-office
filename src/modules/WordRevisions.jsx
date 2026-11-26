import React, {useMemo} from 'react'
import {RibbonGroup} from '../office/Ribbon'
import {ArrowUp,ArrowDown,CheckCheck,ListX,MessageSquarePlus} from 'lucide-react'
import {useEditorState} from '@tiptap/react'
import {revisions,resolveRevisions} from './word-revisions.js'

export default function WordRevisions({editor, enabled, toggle, author, setAuthor,reviewView,setReviewView,beginComment}) {
  const doc=useEditorState({editor,selector:({editor})=>editor.state.doc,equalityFn:Object.is})
  const list=useMemo(()=>revisions(doc),[doc])
  function move(step) {
    const pos=editor.state.selection.from
    const item=step>0?(list.find(i=>i.spans[0].from>pos) || list[0]):(list.findLast(i=>i.spans[0].from<pos) || list.at(-1))
    setReviewView('markup')
    editor.chain().focus().setTextSelection(item.spans[0].from).scrollIntoView().run()
  }
  return <section className="word-revisions" aria-label="文字修订"><div className="word-tools ribbon-panel" role="toolbar" aria-label="审阅工具">
    <RibbonGroup label="批注"><button title="插入批注 (Ctrl+Alt+M)" onClick={beginComment}><MessageSquarePlus size={15}/>插入批注</button></RibbonGroup>
    <RibbonGroup label="修订">
    <label title="开启或关闭修订（Ctrl+Shift+E）"><input type="checkbox" checked={enabled} aria-keyshortcuts="Control+Shift+E" onChange={e=>toggle(e.target.checked)}/>记录文字修订</label>
    <label>修订者 <input aria-label="修订者" value={author} maxLength={128} onChange={e=>setAuthor(e.target.value)}/></label>
    </RibbonGroup><RibbonGroup label="显示标记"><select aria-label="显示修订状态" value={reviewView} onChange={e=>setReviewView(e.target.value)}>
      <option value="markup">显示标记的最终状态</option><option value="final">最终状态（预览）</option><option value="original">原始状态（预览）</option></select>
    </RibbonGroup><RibbonGroup label="接受与拒绝">
      <button disabled={!list.length} onClick={()=>resolveRevisions(editor,list,true)}><CheckCheck size={15}/>接受全部修订</button>
      <button disabled={!list.length} onClick={()=>resolveRevisions(editor,list,false)}><ListX size={15}/>拒绝全部修订</button>
    </RibbonGroup><RibbonGroup label="定位修订">
      <button disabled={!list.length} onClick={()=>move(-1)}><ArrowUp size={15}/>上一处修订</button><button disabled={!list.length} onClick={()=>move(1)}><ArrowDown size={15}/>下一处修订</button>
    </RibbonGroup></div>
    {list.length>0 && <ol>{list.map(item=><li key={item.id}>
        <button title="定位修订" onClick={()=>editor.chain().focus().setTextSelection(item.spans[0].from).scrollIntoView().run()}>{item.author} · {{ins:'插入',del:'删除',format:'格式'}[item.kind]} {item.text.slice(0,60)}</button>
        <button onClick={()=>resolveRevisions(editor,[item],true)}>接受</button>
        <button onClick={()=>resolveRevisions(editor,[item],false)}>拒绝</button>
      </li>)}</ol>}
  </section>
}
