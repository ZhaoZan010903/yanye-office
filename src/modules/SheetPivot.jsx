import React, { useState } from 'react'
import { address, location, rangeName } from './spreadsheet.js'
import { createPivot, pivotHeaders, refreshPivot, summaries } from './sheet-pivot.js'

export default function SheetPivot({book, sheet, range, display, apply, close}) {
  const p=sheet.pivot, source=p ? book.sheets.find(s=>s.id===p.sourceId) : sheet
  const [ref,setRef]=useState(()=>{
    if(p) return p.ref
    if(range.top!==range.bottom || range.left!==range.right) return rangeName(range)
    const positions=Object.keys(source.cells).map(location)
    const box=positions.reduce((b,v)=>({top:Math.min(b.top,v.row),bottom:Math.max(b.bottom,v.row),
      left:Math.min(b.left,v.col),right:Math.max(b.right,v.col)}),{top:Infinity,left:Infinity,bottom:0,right:0})
    return positions.length ? rangeName(box) : address(0,0)+':B2'
  })
  const [row,setRow]=useState(p?.rowField??0), [field,setField]=useState(p?.dataField??1)
  const [summary,setSummary]=useState(p?.summary??'sum'), [error,setError]=useState('')
  let headers=[],hint=''
  try { headers=pivotHeaders(source,ref,display) } catch(e) { hint=e.message }
  const options=headers.map((h,i)=><option key={i} value={i}>{h}</option>)
  function confirm(event) {
    event.preventDefault()
    try {
      const config={ref:ref.toUpperCase(),rowField:row,dataField:field,summary}
      let next
      if(p) {
        const updated=refreshPivot(book,{...sheet,pivot:{...p,...config,caption:p.summary===summary && p.dataField===field?p.caption:undefined}})
        next={...book,sheets:book.sheets.map(s=>s.id===sheet.id?updated:s)}
      } else next=createPivot(book,sheet,config)
      if(apply(next)) close()
    } catch(e) { setError(e.message) }
  }
  return <form className="sheet-pivot-form" aria-label="数据透视表字段" onSubmit={confirm}>
    <label>{source?.name} 数据区域<input value={ref} onChange={e=>setRef(e.target.value.trim().toUpperCase())}/></label>
    <label>行字段<select value={row} onChange={e=>setRow(Number(e.target.value))}>{options}</select></label>
    <label>值字段<select value={field} onChange={e=>setField(Number(e.target.value))}>{options}</select></label>
    <label>汇总方式<select value={summary} onChange={e=>setSummary(e.target.value)}>{Object.entries(summaries).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <button disabled={!!hint || !headers[row] || !headers[field]}>{p?'应用字段设置':'在新工作表创建'}</button>
    <button type="button" onClick={close}>取消</button>
    {(error || hint) && <span role="status">{error || hint}</span>}
  </form>
}
