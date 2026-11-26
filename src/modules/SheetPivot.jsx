import React, {useMemo,useState} from 'react'
import {address,location,rangeName} from './spreadsheet.js'
import {createPivot,pivotData,pivotHeaders,pivotKey,refreshPivot,rowAxis,summaries} from './sheet-pivot.js'
import './sheet-pivot.css'

export default function SheetPivot({book,sheet,range,display,apply,close}) {
  const p=sheet.pivot, source=p ? book.sheets.find(s=>s.id===p.sourceId) : sheet
  const [ref,setRef]=useState(()=>{
    if(p) return p.ref
    if(range.top!==range.bottom || range.left!==range.right) return rangeName(range)
    const positions=Object.keys(source.cells).map(location)
    const box=positions.reduce((b,v)=>({top:Math.min(b.top,v.row),bottom:Math.max(b.bottom,v.row),
      left:Math.min(b.left,v.col),right:Math.max(b.right,v.col)}),{top:Infinity,left:Infinity,bottom:0,right:0})
    return positions.length ? rangeName(box) : address(0,0)+':B2'
  })
  const [rows,setRows]=useState(p?rowAxis(p):[0]),[column,setColumn]=useState(p?.columnField??'')
  const [data,setData]=useState(p?.dataField??1),[summary,setSummary]=useState(p?.summary??'sum')
  const [layout,setLayout]=useState(p?.layout??'tabular')
  const [slicers,setSlicers]=useState(p?.slicers??[]),[error,setError]=useState('')
  let headers=[],hint=''
  try {headers=pivotHeaders(source,ref,display)} catch(e){hint=e.message}
  function options(exclude=[]) {return headers.map((label,i)=><option key={i} value={i} disabled={exclude.includes(i)}>{label}</option>)}
  function confirm(event) {
    event.preventDefault()
    try {
      const config={ref:ref.toUpperCase(),rowField:rows[0],rowFields:rows,columnField:column===''?null:column,dataField:data,summary,slicers,layout}
      let next
      if(p) {
        const subtotalFields=rows.slice(0,-1).filter(f=>!rowAxis(p).slice(0,-1).includes(f) || (p.subtotalFields??rowAxis(p)).includes(f))
        const updated=refreshPivot(book,{...sheet,pivot:{...p,...config,subtotalFields,caption:p.summary===summary && p.dataField===data?p.caption:undefined}})
        next={...book,sheets:book.sheets.map(s=>s.id===sheet.id?updated:s)}
      } else next=createPivot(book,sheet,config)
      if(apply(next)) close()
    } catch(e) {setError(e.message)}
  }
  const available=headers.findIndex((_,i)=>!rows.includes(i) && column!==i)
  return <form className="sheet-pivot-form pivot-fields" aria-label="数据透视表字段" onSubmit={confirm}>
    <label>{source?.name} 数据区域<input value={ref} onChange={e=>setRef(e.target.value.trim().toUpperCase())}/></label>
    <fieldset><legend>行</legend>{rows.map((f,k)=><div key={k} className="pivot-field-line">
      <label>{k?'第 '+(k+1)+' 级行字段':'行字段'}<select value={f} onChange={e=>setRows(rows.map((v,i)=>i===k?Number(e.target.value):v))}>{options([...rows.filter((_,i)=>i!==k),column])}</select></label>
      {k>0 && <button type="button" aria-label={'上移第 '+(k+1)+' 级行字段'} onClick={()=>{const next=[...rows];[next[k-1],next[k]]=[next[k],next[k-1]];setRows(next)}}>↑</button>}
      {rows.length>1 && <button type="button" aria-label={'移除第 '+(k+1)+' 级行字段'} onClick={()=>setRows(rows.filter((_,i)=>i!==k))}>×</button>}
    </div>)}<button type="button" disabled={available<0} onClick={()=>setRows([...rows,available])}>添加行字段</button></fieldset>
    <label>列字段<select aria-label="列字段" value={column} onChange={e=>setColumn(e.target.value===''?'':Number(e.target.value))}><option value="">无</option>{options(rows)}</select></label>
    <label>值字段<select aria-label="值字段" value={data} onChange={e=>setData(Number(e.target.value))}>{options()}</select></label>
    <label>汇总方式<select value={summary} onChange={e=>setSummary(e.target.value)}>{Object.entries(summaries).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label>报表布局<select value={layout} onChange={e=>setLayout(e.target.value)}><option value="tabular">表格形式</option><option value="compact">压缩形式</option></select></label>
    <fieldset><legend>切片器</legend>
      {slicers.map(s=><div key={s.field} className="pivot-field-line">{headers[s.field]}<button type="button" aria-label={'移除切片器 '+headers[s.field]} onClick={()=>setSlicers(slicers.filter(item=>item.field!==s.field))}>×</button></div>)}
      <select aria-label="插入切片器" value="" onChange={e=>{if(e.target.value!=='')setSlicers([...slicers,{field:Number(e.target.value),selected:null}])}}>
        <option value="">选择切片器字段…</option>{options(slicers.map(s=>s.field))}</select>
    </fieldset>
    <button disabled={!!hint}>{p?'应用字段设置':'在新工作表创建'}</button><button type="button" onClick={close}>取消</button>
    {(error || hint) && <span role="status">{error || hint}</span>}
  </form>
}

function Slicer({slicer,caption,members,change}) {
  const [multi,setMulti]=useState(false),[query,setQuery]=useState('')
  const selected=new Set((slicer.selected??members).map(pivotKey))
  const choices=members.filter(v=>String(v===''?'(空白)':v).toLowerCase().includes(query.toLowerCase()))
  function select(v,modifier) {
    if(!multi && !modifier) {change([v]);return}
    const next=new Set(selected),key=pivotKey(v)
    if(next.has(key))next.delete(key);else next.add(key)
    if(next.size)change(next.size===members.length?null:members.filter(m=>next.has(pivotKey(m))))
  }
  return <section className="pivot-slicer" aria-label={caption+' 切片器'}>
    <header><strong>{caption}</strong><button type="button" aria-pressed={multi} onClick={()=>setMulti(!multi)}>多选</button>
      <button type="button" disabled={!slicer.selected} onClick={()=>change(null)}>清除筛选</button></header>
    {members.length>12 && <input type="search" aria-label={'查找 '+caption} value={query} onChange={e=>setQuery(e.target.value)}/>}
    <div className="pivot-slicer-items">{choices.map(v=><button type="button" key={JSON.stringify(v)} aria-pressed={selected.has(pivotKey(v))}
      onClick={e=>select(v,e.ctrlKey||e.metaKey)}>{v===''?'(空白)':String(v)}</button>)}</div>
  </section>
}
export function PivotSlicers({book,sheet,onChange,onError}) {
  const report=useMemo(()=>{try{return pivotData(book,sheet.pivot)}catch{return null}},[book,sheet.pivot])
  if(!report) return null
  function change(field,selected) {
    try {
      const slicers=sheet.pivot.slicers.map(s=>s.field===field?{...s,selected}:s)
      const updated=refreshPivot(book,{...sheet,pivot:{...sheet.pivot,slicers}})
      onChange({...book,sheets:book.sheets.map(s=>s.id===sheet.id?updated:s)})
    }catch(e){onError(e.message)}
  }
  return <div className="pivot-slicer-strip">{sheet.pivot.slicers.map(s=><Slicer key={s.field} slicer={s} caption={s.caption??report.headers[s.field]}
    members={report.members[s.field]} change={selected=>change(s.field,selected)}/>)}</div>
}
