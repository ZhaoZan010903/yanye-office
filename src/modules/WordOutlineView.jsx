import { useState } from 'react'
import { ChevronLeft, ChevronRight, CornerDownRight, ListTree } from 'lucide-react'

export default function WordOutlineView({editor,headings,openHeading}) {
  const [depth,setDepth] = useState(6)
  const [position,select] = useState(null)
  const visible = headings.filter(h=>h.level <= depth)
  const current = visible.find(h=>h.pos === position) || visible[0]
  function changeLevel(step) {
    if (!current) return
    editor.chain().setTextSelection(current.pos+1).updateAttributes('heading',{level:current.level+step}).run()
  }
  return <section className="word-outline-view" aria-label="文档大纲">
    <div className="word-outline-commands">
      <label><ListTree size={16}/>显示级别
        <select value={depth} onChange={e=>setDepth(Number(e.target.value))}>
          {[1,2,3,4,5,6].map(n=><option key={n} value={n}>{n} 级</option>)}
        </select>
      </label>
      <button disabled={!current || current.level===1} onClick={()=>changeLevel(-1)}><ChevronLeft size={15}/>提升一级</button>
      <button disabled={!current || current.level===6} onClick={()=>changeLevel(1)}><ChevronRight size={15}/>降低一级</button>
      <button disabled={!current} onClick={()=>openHeading(current.pos)}><CornerDownRight size={15}/>转到正文</button>
    </div>
    {visible.length ? <ol>{visible.map(h=><li key={h.pos}>
      <button style={{paddingInlineStart:8+16*(h.level-1)}} aria-pressed={current?.pos===h.pos}
        onClick={()=>select(h.pos)} onDoubleClick={()=>openHeading(h.pos)}>
        <small>{h.level} 级</small>{h.text || '空标题'}
      </button></li>)}</ol> : <p>当前级别下没有标题。在「开始」中为段落应用标题样式后，即可在大纲中调整层级。</p>}
  </section>
}
