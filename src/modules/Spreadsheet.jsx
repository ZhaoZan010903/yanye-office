import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, ChevronDown, FileDown, FileUp, Filter, Plus, Table2 } from 'lucide-react'
import {
  address, columnName, csvText, emptyWorkbook, evaluator, fillFrom, formatted, LIMITS, newSheet, parseDelimited,
  removeSheet, renameSheet, shiftGrid, writeRange,
} from './spreadsheet.js'
import { appendSheets, availableName, exchangeNote, readXlsx, writeXlsx } from './spreadsheet-xlsx.js'
import './spreadsheet.css'

const rowHeight = 30
const collator = new Intl.Collator('zh-CN', { numeric: true })

function SheetChart({ sheet, display, rows, col }) {
  const series = rows.filter(r => r !== 0).map(row => ({
    label: display(sheet,address(row,0)) || String(row+1), value: display(sheet,address(row,col)),
  })).filter(item => typeof item.value === 'number').slice(0,20)
  const max = Math.max(1,...series.map(item => Math.abs(item.value)))
  return <section className="sheet-chart" aria-label="柱状图">
    <strong>{columnName(col)} 列柱状图</strong>
    {!series.length ? <p>选择有数字的列。第一列用作标签，第一行用作表头。</p> :
      <div>{series.map(({label,value},i) => <div className="sheet-bar-row" key={i}>
        <span title={String(label)}>{label}</span><i style={{ width: Math.abs(value)/max*100+'%' }} /><b>{value}</b>
      </div>)}</div>}
  </section>
}

function SheetMenu({ label, icon: Icon, children }) {
  const ref = useRef(null)
  return <details className="sheet-menu" ref={ref} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) ref.current.open = false
  }} onKeyDown={event => { if (event.key === 'Escape') { ref.current.open = false; ref.current.querySelector('summary').focus() } }}>
    <summary>{Icon && <Icon size={14} />} {label}<ChevronDown size={12} /></summary>
    <div className="sheet-menu-list" onClick={() => { ref.current.open = false }}>{children}</div>
  </details>
}

export default function Spreadsheet({ value, onChange, onImport, onExport }) {
  const blank = useMemo(emptyWorkbook, [])
  const book = Array.isArray(value?.sheets) && value.sheets.length ? value : blank
  const sheet = book.sheets.find(s => s.id === book.active) ?? book.sheets[0]
  const latest = useRef(book)
  latest.current = book
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [selection, select] = useState({ row:0, col:0 })
  const [editing, setEditing] = useState(false)
  const [rename, setRename] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [scroll, setScroll] = useState(0)
  const [height, setHeight] = useState(450)
  const scroller = useRef(null), editInput = useRef(null), original = useRef(''), focusGrid = useRef(false)
  const row = Math.min(selection.row, sheet.rows-1), col = Math.min(selection.col,sheet.cols-1)
  const selected = address(row,col)
  const raw = sheet.cells[selected] ?? ''
  const display = useMemo(() => evaluator(book),[book])
  const sort = sheet.sort
  const filter = sheet.query ?? ''
  const allRows = useMemo(() => {
    let rows = Array.from({ length: sheet.rows-1 }, (_,i) => i+1)
    if (filter.trim()) {
      const needle = filter.toLocaleLowerCase().trim()
      rows = rows.filter(r => {
        for (let c=0; c<sheet.cols; c++) if (String(display(sheet,address(r,c))).toLocaleLowerCase().includes(needle)) return true
        return false
      })
    }
    if (sort) rows.sort((a,b) => {
      const left = display(sheet,address(a,sort.col)), right = display(sheet,address(b,sort.col))
      if (left === '' || right === '') return Number(left === '') - Number(right === '')
      const compare = typeof left === 'number' && typeof right === 'number' ? left-right : collator.compare(String(left),String(right))
      return sort.desc ? -compare : compare
    })
    return [0,...rows]
  }, [sheet,display,sort,filter])
  const first = Math.max(0, Math.min(allRows.length-1,Math.floor(scroll/rowHeight)-5))
  const last = Math.min(allRows.length, first+Math.ceil(height/rowHeight)+12)
  const visibleRows = allRows.slice(first,last)
  const frozenHeaderDetached = sheet.freezeHeader && first>0
  if (frozenHeaderDetached) visibleRows.unshift(0)
  const cols = Array.from({length:sheet.cols},(_,i)=>i)

  useLayoutEffect(() => {
    const observer = new ResizeObserver(entries => setHeight(entries[0].contentRect.height))
    observer.observe(scroller.current)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (editing) editInput.current?.focus()
    else if (focusGrid.current) scroller.current?.focus({preventScroll:true})
    focusGrid.current = false
  }, [editing,selection,sheet.id])
  function change(next) {
    if (onChange(next) === false) return false
    latest.current = next
    return true
  }
  function updateSheet(next) {
    const current = latest.current
    change({ ...current, sheets:current.sheets.map(s=>s.id===next.id ? next : s) })
  }
  function tryAction(fn) {
    try { fn(); setNotice('') } catch (error) { setNotice(error.message) }
  }
  function put(text) {
    tryAction(() => updateSheet(writeRange(sheet,row,col,[[text]])))
  }
  function go(r,c,focus = true) {
    r = Math.max(0,Math.min(sheet.rows-1,r)); c = Math.max(0,Math.min(sheet.cols-1,c))
    setEditing(false); focusGrid.current = focus; select({row:r,col:c})
    if (!focus) return
    const index = allRows.indexOf(r), box = scroller.current
    if (index >= 0 && box) {
      const top = index*rowHeight
      if (top < box.scrollTop) box.scrollTop = top
      if (top + rowHeight*2 > box.scrollTop + box.clientHeight) box.scrollTop = top + rowHeight*2 - box.clientHeight
      const left = 44+c*104
      if (left < box.scrollLeft+44) box.scrollLeft = left-44
      if (left+104 > box.scrollLeft+box.clientWidth) box.scrollLeft = left+104-box.clientWidth
    }
  }
  function vertical(delta) {
    const index = Math.max(0, allRows.indexOf(row))
    go(allRows[Math.max(0,Math.min(allRows.length-1,index+delta))],col)
  }
  function startEditing(text) {
    original.current = raw; setEditing(true)
    if (text !== undefined) put(text)
  }
  function gridKeys(event) {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Enter') { event.preventDefault(); if (editing) vertical(event.shiftKey ? -1 : 1); else startEditing(); return }
    if (event.key === 'Tab') { event.preventDefault(); go(row,col+(event.shiftKey?-1:1)); return }
    if (editing) {
      if (event.key === 'Escape') { event.preventDefault(); put(original.current); go(row,col) }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); vertical(event.key === 'ArrowDown' ? 1 : -1) }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); go(row,col+(event.key === 'ArrowRight'?1:-1)) }
    else if (event.key === 'F2') { event.preventDefault(); startEditing() }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); put('') }
    else if (event.key.length === 1) { event.preventDefault(); startEditing(event.key) }
  }
  function switchSheet(id) {
    change({...book,active:id}); select({row:0,col:0}); setEditing(false); setRename(false); setRemoving(null)
    scroller.current.scrollTop = 0; scroller.current.scrollLeft = 0
    setNotice('')
  }
  function addSheet() {
    if (book.sheets.length >= LIMITS.sheets) return setNotice('工作簿最多 32 张工作表。')
    const name = availableName('工作表'+(book.sheets.length+1),book.sheets)
    const added = newSheet(name)
    change({...book,sheets:[...book.sheets,added],active:added.id})
    select({row:0,col:0}); setRename(false); setEditing(false); scroller.current.scrollTop = 0; scroller.current.scrollLeft = 0
  }
  function structure(axis,delta) {
    tryAction(() => {
      const next = shiftGrid(book,sheet.id,axis,axis === 'row' ? row : col,delta)
      change(next); setEditing(false)
    })
  }
  async function exchange(ext, input) {
    setBusy(true); setNotice('')
    try {
      if (input) {
        const file = await onImport(ext)
        if (!file || !mounted.current) return
        const imported = ext === 'xlsx' ? await readXlsx(file.text) :
          [writeRange(newSheet(file.name.replace(/\.csv$/i,'')),0,0,parseDelimited(file.text))]
        if (!mounted.current) return
        const current = latest.current === blank ? { sheets: [] } : latest.current
        if (!change(appendSheets(current, imported))) { setNotice('工作区空间不足，未添加工作表。'); return }
        select({row:0,col:0}); setEditing(false); setRename(false)
        scroller.current.scrollTop = 0; scroller.current.scrollLeft = 0
        setNotice('已添加 '+imported.length+' 张工作表。')
      } else {
        const content = ext === 'xlsx' ? await writeXlsx(book) : '\uFEFF'+csvText(sheet,display)
        if (await onExport(sheet.name+'.'+ext,content) && mounted.current) setNotice('已导出 '+ext.toUpperCase()+'。')
      }
    } catch (error) { if (mounted.current) setNotice(error.message) }
    finally { if (mounted.current) setBusy(false) }
  }
  return <section className="sheet-module" aria-label="电子表格">
    <div className="sheet-toolbar">
      <SheetMenu label="行与列" icon={Table2}>
        <button onClick={()=>structure('row',1)}>在上方插入行</button><button onClick={()=>structure('col',1)}>在左侧插入列</button>
        <button disabled={sheet.rows<=1} onClick={()=>structure('row',-1)}>删除所选行</button><button disabled={sheet.cols<=1} onClick={()=>structure('col',-1)}>删除所选列</button>
        <button onClick={()=>setRename(true)}>重命名工作表</button>
        <button onClick={()=>updateSheet({...sheet,freezeHeader:!sheet.freezeHeader})}>{sheet.freezeHeader?'取消冻结首行':'冻结首行'}</button>
        <button onClick={()=>updateSheet({...sheet,freezeColumn:!sheet.freezeColumn})}>{sheet.freezeColumn?'取消冻结首列':'冻结首列'}</button>
        <button disabled={book.sheets.length===1} onClick={()=>setRemoving(sheet.id)}>删除当前工作表</button>
      </SheetMenu>
      <SheetMenu label="单元格">
        {[['常规',null],['两位小数','number'],['人民币','currency'],['百分比','percent']].map(([label,style])=>
          <button key={label} onClick={()=>{
            const formats = {...sheet.formats}
            if (style) formats[selected]=style
            else delete formats[selected]
            updateSheet({...sheet,formats})
          }}>{label}</button>)}
        <button disabled={row===0} onClick={()=>updateSheet(fillFrom(sheet,row,col,'down'))}>从上方填充</button>
        <button disabled={col===0} onClick={()=>updateSheet(fillFrom(sheet,row,col,'right'))}>从左侧填充</button>
      </SheetMenu>
      <SheetMenu label="排序与筛选" icon={Filter}>
        <button onClick={()=>updateSheet({...sheet,sort:{col,desc:false}})}>按 {columnName(col)} 列升序</button>
        <button onClick={()=>updateSheet({...sheet,sort:{col,desc:true}})}>按 {columnName(col)} 列降序</button>
        <button disabled={!sort} onClick={()=>updateSheet({...sheet,sort:null})}>还原行序</button>
        <button onClick={()=>setFilterOpen(true)}>筛选行</button>
      </SheetMenu>
      <button className="sheet-action" aria-pressed={!!sheet.chart} onClick={()=>updateSheet({...sheet,chart:sheet.chart?null:{col}})}><BarChart3 size={15}/>柱状图</button>
      <SheetMenu label="导入" icon={FileUp}><button disabled={busy} onClick={()=>exchange('csv',true)}>导入 CSV</button><button disabled={busy} onClick={()=>exchange('xlsx',true)}>导入 XLSX</button></SheetMenu>
      <SheetMenu label="导出" icon={FileDown}><button disabled={busy} onClick={()=>exchange('csv',false)}>导出 CSV</button><button disabled={busy} onClick={()=>exchange('xlsx',false)}>导出 XLSX</button></SheetMenu>
    </div>
    {removing===sheet.id && <div className="sheet-filter" role="alert"><span>删除“{sheet.name}”后，引用此表的公式将显示 #REF!。</span>
      <button onClick={()=>{change(removeSheet(book,sheet.id));setRemoving(null);select({row:0,col:0});setEditing(false)}}>确认删除工作表</button>
      <button onClick={()=>setRemoving(null)}>取消</button>
    </div>}
    <div className="sheet-formula"><output>{selected}</output><span aria-hidden="true">ƒx</span><input aria-label="公式栏" placeholder="输入值或 =SUM(A1:A3)" maxLength={LIMITS.text} value={raw}
      onChange={e=>put(e.target.value)} onKeyDown={e=>{ if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); vertical(1) } }}/></div>
    {(filterOpen || filter) && <div className="sheet-filter"><Filter size={14}/><input autoFocus aria-label="工作表筛选" placeholder="按内容筛选，保留第一行表头" value={filter} onChange={e=>updateSheet({...sheet,query:e.target.value})}/><button onClick={()=>{updateSheet({...sheet,query:''});setFilterOpen(false)}}>清除筛选</button></div>}
    {sheet.chart && <SheetChart sheet={sheet} display={display} rows={allRows} col={sheet.chart.col} />}
    <div ref={scroller} className="sheet-scroll" role="region" aria-label="工作表网格" tabIndex={0}
      onScroll={e=>setScroll(e.currentTarget.scrollTop)} onKeyDown={gridKeys}
      onCopy={e=>{if (!editing) { e.preventDefault(); e.clipboardData.setData('text/plain',String(display(sheet,selected))) }}}
      onPaste={e=>{
        const data = e.clipboardData.getData('text/plain')
        if (editing && !/[\r\n\t]/.test(data)) return
        e.preventDefault(); tryAction(()=>{ updateSheet(writeRange(sheet,row,col,parseDelimited(data,'\t'))); setEditing(false) })
      }}>
      <table aria-label={sheet.name} className={sheet.freezeColumn?'sheet-freeze-column':''} style={{width:44+104*sheet.cols}}><colgroup><col style={{width:44}}/>{cols.map(c=><col key={c} style={{width:104}}/>)}</colgroup>
        <thead><tr><th aria-label="行号"/>{cols.map(c=><th key={c} scope="col" className={c===col?'sheet-head-active':''}>{columnName(c)}{sort?.col===c?(sort.desc?' ↓':' ↑'):''}</th>)}</tr></thead>
        <tbody>
          {first>0 && !frozenHeaderDetached && <tr aria-hidden="true"><td colSpan={cols.length+1} style={{height:first*rowHeight}}/></tr>}
          {visibleRows.map(r=><React.Fragment key={r}><tr className={sheet.freezeHeader && r===0?'sheet-frozen-row':''}><th scope="row" className={r===row?'sheet-head-active':''}>{r+1}</th>
            {cols.map(c=>{
              const ref = address(r,c), active = r===row && c===col
              const result = display(sheet,ref)
              return <td key={c} data-address={ref} aria-label={ref} className={(active?'sheet-selected ':'')+(typeof result==='number'?'sheet-number':'')}
                onMouseDown={e=>{if(e.target.tagName!=='INPUT') e.preventDefault()}}
                onClick={()=>{if(!active || !editing) go(r,c)}} onDoubleClick={()=>{if(!editing) { original.current=sheet.cells[ref]??''; setEditing(true) }}}>
                {active && editing ? <input ref={editInput} aria-label={'编辑 '+ref} maxLength={LIMITS.text} value={raw} onChange={e=>put(e.target.value)} onBlur={()=>setEditing(false)}/> : <span>{formatted(result,sheet.formats?.[ref])}</span>}
              </td>
            })}
          </tr>{r===0 && frozenHeaderDetached && first>1 && <tr aria-hidden="true"><td colSpan={cols.length+1} style={{height:(first-1)*rowHeight}}/></tr>}</React.Fragment>)}
          {last<allRows.length && <tr aria-hidden="true"><td colSpan={cols.length+1} style={{height:(allRows.length-last)*rowHeight}}/></tr>}
        </tbody>
      </table>
    </div>
    <div className="sheet-tabs" aria-label="工作表列表">{book.sheets.map(s=>
      s.id===sheet.id && rename ? <input aria-label="工作表名称" autoFocus key={s.id} defaultValue={s.name} maxLength={31}
        onFocus={e=>e.target.select()} onBlur={e=>{tryAction(()=>change(renameSheet(book,s.id,e.target.value)));setRename(false)}}
        onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Enter')e.target.blur();if(e.key==='Escape'){e.target.value=s.name;e.target.blur()}}}/> :
        <button key={s.id} aria-pressed={s.id===sheet.id} onClick={()=>switchSheet(s.id)} onDoubleClick={()=>setRename(true)}>{s.name}</button>)}
      <button title="新建工作表" aria-label="新建工作表" onClick={addSheet}><Plus size={15}/></button>
    </div>
    <div className="sheet-info"><span role="status">{busy?'正在交换文件…':notice || (filter ? '显示 '+(allRows.length-1)+' 条匹配数据' : sheet.rows+' 行 · '+sheet.cols+' 列')}</span>
      <details><summary>文件交换说明</summary><p>{exchangeNote}</p></details></div>
  </section>
}
