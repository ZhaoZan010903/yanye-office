import React, {useEffect, useState} from 'react'
import {address, columnName, findMerge, inRect, LIMITS, location} from './spreadsheet.js'
import './spreadsheet.css'

const moduleType={Document:'文档模块',Module:'标准模块',Class:'类模块',BaseClass:'窗体'}
function ProjectView({project,disk,base}) {
  const [reader,setReader]=useState(null), [module,setModule]=useState(project.modules[0]?.name||'')
  const [error,setError]=useState('')
  useEffect(()=>{
    if(project.sourceState!=='available' || (!base && !disk)) return
    let active=true
    async function open() {
      const {openProjectReader}=await import('./preserved-workbook.js')
      const api=window.yanye.library
      const bytes=base ? await api.readWorkbookBase(base.id,base.revision) : await api.readOfficeSource(disk.id,disk.revision)
      const loaded=await openProjectReader(bytes)
      if(active) setReader(loaded)
    }
    setReader(null);setError('')
    open().catch(e=>{if(active) setError(e.message)})
    return ()=>{active=false}
  },[disk?.id,disk?.revision,base?.id,base?.revision,project.sourceState])
  const source=React.useMemo(()=>{
    if(!reader || !module) return null
    try {return {text:reader.source(module)}} catch(e) {return {error:e.message}}
  },[reader,module])
  return <section className="vb-project" aria-label="VBA 项目信息">
    <strong>{project.name || 'VBA 项目'}</strong><p>{project.size.toLocaleString()} 字节 · SHA-256 <code>{project.sha256}</code></p>
    {project.modules.length>0 && <label>模块 <select aria-label="VBA 模块" value={module} onChange={e=>setModule(e.target.value)}>
      {project.modules.map((m,i)=><option key={i} value={m.name}>{m.name} · {moduleType[m.type]||m.type}</option>)}
    </select></label>}
    {source && !source.error && <textarea aria-label="VBA 模块源码" readOnly value={source.text} spellCheck={false}/>}
    {(error || source?.error) && <p role="alert">{error || source.error}</p>}
    {project.sourceState==='protected' && <p>项目受保护或缺少明确的开放标记，源码不可用。</p>}
    {project.sourceState==='available' && !reader && !error && <p role="status">读取模块源码…</p>}
    {(project.unreadable || project.sourceState==='unsupported') && <p>项目源码目录无法校验，原项目随工作簿保留。</p>}
  </section>
}
export default function PreservedWorkbook({value,onChange,disk}) {
  const {preserved,sheets}=value
  const [active,setActive]=useState(value.active)
  const sheet=sheets.find(s=>s.id===active) || sheets[0]
  const [ref,choose]=useState('A1'), [addressText,setAddressText]=useState('A1')
  const [projectOpen,setProjectOpen]=useState(false),[notice,setNotice]=useState('')
  const spot=location(ref), rowStart=Math.floor(spot.row/40)*40, colStart=Math.floor(spot.col/8)*8
  const currentEdits=Object.hasOwn(preserved.edits||{},sheet.name)?preserved.edits[sheet.name]:{}
  const valueAt=key=>Object.hasOwn(currentEdits,key)?currentEdits[key]:(sheet.cells[key]??'')
  const current=valueAt(ref), [draft,setDraft]=useState(current)
  useEffect(()=>{setDraft(current);setAddressText(ref);setNotice('')},[current,ref,sheet.id])
  const lock=preserved.locks?.[sheet.name], merged=findMerge(sheet,spot.row,spot.col)
  const locked=preserved.signature || lock?.sheet || current.startsWith('=') ||
    (merged && (merged.top!==spot.row || merged.left!==spot.col)) || lock?.areas?.some(box=>inRect(box,spot.row,spot.col))
  function select(next) {
    if(draft!==current && !commit()) return
    choose(next)
  }
  function commit(next=draft) {
    if(next===current) return true
    if(locked || next.startsWith('=') || next.length>LIMITS.text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(next)) {
      setNotice('此处只能修改普通文本或数值常量。');return false
    }
    return onChange({...value,preserved:{...preserved,edits:{...preserved.edits,[sheet.name]:{...currentEdits,[ref]:next}}}})!==false
  }
  return <section className="preserved-workbook" aria-label="原包工作簿">
    <div className="sheet-pivot-form"><strong>保留原包编辑</strong>
      <span>{preserved.signature?'带文档签名，仅供阅读':'可修改普通单元格常量，保存时保留原文件中的对象。'}</span>
      {preserved.project && <button aria-expanded={projectOpen} onClick={()=>setProjectOpen(!projectOpen)}>查看 VBA 项目</button>}
    </div>
    {projectOpen && <ProjectView project={preserved.project} disk={disk} base={preserved.base}/>}
    <div className="sheet-pivot-form">
      <label>工作表<select value={sheet.id} onChange={e=>{if(commit()) {setActive(e.target.value); choose('A1')}}}>{sheets.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <form onSubmit={e=>{e.preventDefault();const p=location(addressText.trim());if(p && p.row<LIMITS.rows && p.col<LIMITS.cols) select(address(p.row,p.col));else setNotice('单元格地址无效。')}}>
        <label>定位单元格<input value={addressText} onChange={e=>setAddressText(e.target.value.toUpperCase())}/></label>
      </form>
      <label>{ref} 的内容<input aria-label="单元格常量" readOnly={!!locked} value={draft}
        onChange={e=>{const next=e.target.value;if(commit(next)) setDraft(next)}}/></label>
      {locked && <span>此单元格保留原始内容</span>}
      {notice && <span role="status">{notice}</span>}
    </div>
    <div className="preserved-grid"><table><thead><tr><th></th>
      {Array.from({length:8},(_,c)=><th key={c}>{columnName(colStart+c)}</th>)}</tr></thead>
      <tbody>{Array.from({length:Math.min(40,LIMITS.rows-rowStart)},(_,y)=><tr key={y}><th>{rowStart+y+1}</th>
        {Array.from({length:8},(_,x)=>{const key=address(rowStart+y,colStart+x),v=valueAt(key)
          return <td key={x}><button type="button" aria-label={key+' '+v} aria-pressed={key===ref} onClick={()=>select(key)}>{v.startsWith("'")?v.slice(1):v}</button></td>
        })}</tr>)}</tbody></table></div>
    <nav className="sheet-pivot-form" aria-label="工作表翻页">
      <button disabled={!rowStart} onClick={()=>select(address(rowStart-40,spot.col))}>上 40 行</button>
      <button disabled={rowStart+40>=LIMITS.rows} onClick={()=>select(address(rowStart+40,spot.col))}>下 40 行</button>
      <button disabled={!colStart} onClick={()=>select(address(spot.row,colStart-8))}>前 8 列</button>
      <button disabled={colStart+8>=LIMITS.cols} onClick={()=>select(address(spot.row,colStart+8))}>后 8 列</button>
    </nav>
  </section>
}
