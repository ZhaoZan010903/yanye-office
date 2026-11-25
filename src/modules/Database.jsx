import React, { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Columns3, FileInput, ListFilter, Plus, Table2 } from 'lucide-react'
import { Dialog } from '../workspace-ui.jsx'
import { emptyBase, fieldTypes, fieldValue, fromMatrix, makeRecord, MAX_CELL_LENGTH, MAX_FIELDS, MAX_RECORDS, operations, removeField, removeRecord, selectRecords, toMatrix, validateBase, views } from './database.js'
import './database.css'

const viewIcons = [Table2, Columns3, CalendarDays]
const defaultBase = emptyBase()
const today = new Date()
const dateKey = (y,m,d) => [y, String(m+1).padStart(2,'0'), String(d).padStart(2,'0')].join('-')

function FieldEditor({ fields, existing, onSubmit, onClose, onDelete, feedback }) {
  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState(existing?.type ?? 'text')
  const [options, setOptions] = useState(existing?.options?.join('\n') ?? '待开始\n进行中\n已完成')
  const numbers = fields.filter(f => f.type === 'number')
  const [left, setLeft] = useState(existing?.left ?? numbers[0]?.id ?? '')
  const [right, setRight] = useState(existing?.right ?? numbers[1]?.id ?? numbers[0]?.id ?? '')
  const [op, setOp] = useState(existing?.op ?? '+')
  const choices = [...new Set(options.split('\n').map(s => s.trim()).filter(Boolean))]
  const valid = name.trim() && !(type === 'select' && !choices.length) && !(type === 'formula' && (!left || !right))
  return <Dialog title={existing ? '编辑字段' : '添加字段'} onClose={onClose}>
    <form className="base-form" onSubmit={e => {
      e.preventDefault()
      if (!valid) return
      const field = { id: existing?.id ?? crypto.randomUUID(), name: name.trim(), type }
      if (type === 'select') field.options = choices
      if (type === 'formula') Object.assign(field, { left, op, right })
      onSubmit(field)
    }}>
      <label>字段名称<input autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>字段类型<select disabled={Boolean(existing)} value={type} onChange={e => setType(e.target.value)}>
        {Object.entries(fieldTypes).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      {type === 'select' && <label>选项（每行一项）<textarea value={options} rows={4} onChange={e => setOptions(e.target.value)} /></label>}
      {type === 'formula' && (numbers.length ? <div className="base-math">
        <select aria-label="左侧数字字段" value={left} onChange={e => setLeft(e.target.value)}>{numbers.map(f => <option value={f.id} key={f.id}>{f.name}</option>)}</select>
        <select aria-label="运算符" value={op} onChange={e => setOp(e.target.value)}>{Object.entries(operations).map(([v,word]) => <option key={v} value={v}>{word}</option>)}</select>
        <select aria-label="右侧数字字段" value={right} onChange={e => setRight(e.target.value)}>{numbers.map(f => <option value={f.id} key={f.id}>{f.name}</option>)}</select>
      </div> : <p>先添加数字字段，再用它们设置计算式。</p>)}
      {feedback}
      <div className="base-form-actions">
        {existing && existing.id !== fields[0].id && <button type="button" onClick={onDelete}>删除字段</button>}
        <button className="button primary" disabled={!valid}>保存字段</button>
      </div>
    </form>
  </Dialog>
}

function RelationCell({ records, recordsById, row, titleId, ...props }) {
  const [focused, setFocused] = useState(false)
  const selected = recordsById.get(props.value)
  const choices = focused ? records.filter(r => r.id !== row.id) : selected ? [selected] : []
  return <select {...props} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
    <option value="">未设置</option>
    {choices.map(r => <option key={r.id} value={r.id}>{r.cells[titleId] || '未命名记录'}</option>)}
  </select>
}

function Cell({ field, row, records, recordsById, titleId, label, onSet }) {
  const value = row.cells[field.id] ?? ''
  const props = { 'aria-label': label, value, onChange: e => onSet(field.id, e.target.value) }
  if (field.type === 'formula') return <output aria-label={label}>{fieldValue(row, field, recordsById, titleId) || '—'}</output>
  if (field.type === 'checkbox') return <input type="checkbox" aria-label={label} checked={Boolean(value)} onChange={e => onSet(field.id, e.target.checked)} />
  if (field.type === 'relation') return <RelationCell {...props} records={records} recordsById={recordsById} row={row} titleId={titleId}/>
  if (field.type === 'select') return <select {...props}>
    <option value="">未设置</option>{field.options.map(o => <option key={o}>{o}</option>)}
  </select>
  return <input {...props} type={field.type === 'number' || field.type === 'date' ? field.type : 'text'} step={field.type === 'number' ? 'any' : undefined} maxLength={MAX_CELL_LENGTH} />
}

export default function Database({ value, title, onChange: persist, onImport, onExport }) {
  const base = value?.version ? value : defaultBase
  const { fields, records, view } = base
  const titleId = fields[0].id
  const [modal, setModalState] = useState(null)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('')
  const [descending, setDescending] = useState(false)
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(),1))
  const [limit, setLimit] = useState(100)
  const byId = useMemo(() => new Map(records.map(r => [r.id,r])), [records])
  const statusFields = fields.filter(f => f.type === 'select')
  const dates = fields.filter(f => f.type === 'date')
  const group = statusFields.find(f => f.id === base.groupField) ?? statusFields[0]
  const date = dates.find(f => f.id === base.dateField) ?? dates[0]
  const currentRow = byId.get(modal?.row)
  const currentField = fields.find(f => f.id === modal?.field)
  const visible = useMemo(() => selectRecords(base, byId, query, sort, descending), [base, query, sort, descending, byId])
  const modalFeedback = message && <p role="alert" className="base-feedback">{message}</p>
  function setModal(next) {
    setMessage('')
    setModalState(next)
  }
  function onChange(next) {
    try {
      if (persist(next) === false) throw new Error('此次修改未写入工作区。请检查页面大小和保存状态后重试。')
      setMessage('')
      return true
    } catch (err) {
      setMessage(err.message || '写入工作区失败。')
      return false
    }
  }

  function setCell(rowId, key, val) {
    onChange({ ...base, records: records.map(r => r.id === rowId ? { ...r, cells: { ...r.cells, [key]:val } } : r) })
  }
  function add(values) {
    if (records.length >= MAX_RECORDS) { setMessage('已达到 5000 条记录上限。'); return }
    const row = makeRecord(fields, values)
    if (onChange({ ...base, records: [...records, row] }) !== false) setModal({ type:'record', row:row.id })
  }
  function saveField(field) {
    if (field.type === 'select' && records.some(r => r.cells[field.id] && !field.options.includes(r.cells[field.id]))) {
      setMessage('有记录正在使用已移除的选项。请先更改这些记录。'); return
    }
    if (onChange({ ...base, fields: currentField ? fields.map(f => f.id === field.id ? field : f) : [...fields, field] }) !== false) setModal(null)
  }
  function deleteField() {
    try {
      if (onChange(removeField(base, currentField.id))) setModal(null)
    } catch (err) { setMessage(err.message) }
  }
  async function exchange(mode, ext) {
    try {
      setMessage('')
      if (mode === 'import') {
        const file = await onImport(ext)
        if (!file) return
        let next
        if (ext === 'json') next = validateBase(JSON.parse(file.text))
        else if (ext === 'csv') { const { parseDelimited } = await import('./spreadsheet.js'); next = fromMatrix(parseDelimited(file.text, ',', MAX_RECORDS + 1)) }
        else {
          const { default: Excel } = await import('exceljs')
          const { verifyArchive } = await import('./spreadsheet-xlsx.js')
          const book = new Excel.Workbook()
          const bytes = Uint8Array.from(atob(file.text), c => c.charCodeAt(0))
          verifyArchive(bytes)
          await book.xlsx.load(bytes, { ignoreNodes: ['drawing','picture','conditionalFormatting','dataValidations'] })
          const sheet = book.worksheets[0]
          if (!sheet || sheet.rowCount > MAX_RECORDS+1 || sheet.columnCount > MAX_FIELDS) throw new Error('工作表为空或超过行列上限。')
          const rows = []
          sheet.eachRow({includeEmpty:true}, row => rows.push(Array.from({length:sheet.columnCount}, (_,i) => row.getCell(i+1).text)))
          next = fromMatrix(rows)
        }
        setModal({ type:'import', next, name:file.name }); return
      }
      let data
      if (ext === 'json') data = JSON.stringify(base, null, 2)
      else if (ext === 'csv') { const { delimitedText } = await import('./spreadsheet.js'); data = '\uFEFF' + delimitedText(toMatrix(base)) }
      else {
        const { default: Excel } = await import('exceljs')
        const book = new Excel.Workbook()
        book.addWorksheet('记录').addRows(toMatrix(base))
        const bytes = new Uint8Array(await book.xlsx.writeBuffer())
        let raw = ''
        for (let i=0; i<bytes.length; i+=8192) raw += String.fromCharCode(...bytes.subarray(i,i+8192))
        data = btoa(raw)
      }
      if (await onExport((title || '多维表格') + '.' + ext, data)) setMessage('已导出 ' + ext.toUpperCase())
    } catch (error) { setMessage(error.message) }
  }
  const cell = (r,f,label) => <Cell row={r} field={f} records={records} recordsById={byId} titleId={titleId}
    label={label} onSet={(key,v) => setCell(r.id,key,v)} />
  const recordButton = r => <button type="button" key={r.id} className="base-card" draggable={view === '看板'}
    onDragStart={e => e.dataTransfer.setData('application/x-yanye-record',r.id)}
    onClick={() => setModal({type:'record', row:r.id})}>{r.cells[titleId]?.trim() || '未命名记录'}</button>
  function calendar() {
    const y = month.getFullYear(), m = month.getMonth()
    const start = (month.getDay()+6)%7, count = new Date(y,m+1,0).getDate()
    const grouped = Map.groupBy(visible, r => r.cells[date.id] || '')
    return <>
      <div className="base-month">
        <button aria-label="上个月" onClick={() => setMonth(new Date(y,m-1,1))}><ChevronLeft size={16}/></button>
        <strong>{y} 年 {m+1} 月</strong>
        <button aria-label="下个月" onClick={() => setMonth(new Date(y,m+1,1))}><ChevronRight size={16}/></button>
        <button onClick={() => setMonth(new Date(today.getFullYear(),today.getMonth(),1))}>本月</button>
      </div>
      <div className="base-calendar">{['一','二','三','四','五','六','日'].map(d => <b key={d}>{d}</b>)}
        {Array.from({length:start}, (_,i) => <div key={'offset'+i}/>)}
        {Array.from({length:count},(_,i) => { const key = dateKey(y,m,i+1); return <div className="base-day" key={key}>
          <button title={'在 '+key+' 新增记录'} onClick={() => add({[date.id]:key})}>{i+1}</button>
          {(grouped.get(key) ?? []).map(recordButton)}
        </div> })}</div>
      {grouped.has('') && <section className="base-unscheduled"><strong>未排期</strong>{grouped.get('').map(recordButton)}</section>}
    </>
  }
  return <div className="base-editor">
    <div className="base-tabs">{views.map((v,i) => { const Icon = viewIcons[i]; return <button className="base-tab" key={v}
      aria-pressed={view === v} onClick={() => onChange({...base,view:v})}><Icon size={15}/>{v}</button> })}
      <span className="base-total">{visible.length} 条记录</span>
      <button onClick={() => setModal({type:'exchange'})}><FileInput size={15}/>导入导出</button>
    </div>
    <div className="base-tools">
      <button onClick={() => add({})}><Plus size={15}/>新增记录</button>
      <button disabled={fields.length >= MAX_FIELDS} onClick={() => setModal({type:'field'})}>添加字段</button>
      <label className="base-search"><ListFilter size={15}/><input aria-label="筛选记录" placeholder="筛选记录" value={query} onChange={e => {setQuery(e.target.value);setLimit(100)}} /></label>
      <select aria-label="排序字段" value={sort} onChange={e => setSort(e.target.value)}><option value="">原始顺序</option>{fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
      {sort && <button onClick={() => setDescending(!descending)}>{descending ? '降序' : '升序'}</button>}
      {view === '看板' && group && <label>分组 <select value={group.id} onChange={e => onChange({...base,groupField:e.target.value})}>{statusFields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      {view === '日历' && date && <label>按日期 <select value={date.id} onChange={e => onChange({...base,dateField:e.target.value})}>{dates.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
    </div>
    {!modal && message && <p role="status" className="base-feedback">{message} <button onClick={() => setMessage('')}>关闭提示</button></p>}
    <div className="base-data">
      {view === '表格' && <><table className="base-grid"><thead><tr><th scope="col">记录</th>{fields.map(f => <th key={f.id}>
        <button title={'编辑字段 '+f.name} onClick={() => setModal({type:'field',field:f.id})}>{f.name}<small>{fieldTypes[f.type]}</small></button>
      </th>)}</tr></thead><tbody>{visible.slice(0,limit).map((r,i) => <tr key={r.id}>
        <td><button aria-label={'打开记录 '+(i+1)} onClick={() => setModal({type:'record',row:r.id})}>{i+1}</button></td>
        {fields.map(f => <td key={f.id}>{cell(r,f,(i+1)+' 行 '+f.name)}</td>)}</tr>)}</tbody></table>
        {!visible.length && <p className="base-blank">{records.length ? '没有匹配的记录' : '暂无记录'}</p>}
        {visible.length>limit && <button onClick={() => setLimit(limit+100)}>再显示 100 条</button>}</>}
      {view === '看板' && (group ? <div className="base-board">{[...group.options, ''].map(option => <section key={option}
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id=e.dataTransfer.getData('application/x-yanye-record'); if (byId.has(id)) setCell(id,group.id,option) }}>
        <header><strong>{option || '未设置'}</strong><button aria-label={'在'+(option || '未设置')+'组新增'} onClick={() => add({[group.id]:option})}><Plus size={14}/></button></header>
        {visible.filter(r => (r.cells[group.id] || '') === option).map(recordButton)}</section>)}</div> : <p className="base-blank">请添加单选字段，为看板提供分组。</p>)}
      {view === '日历' && (date ? calendar() : <p className="base-blank">请添加日期字段，为日历提供排期。</p>)}
    </div>
    {modal?.type === 'record' && currentRow && <Dialog title="记录详情" onClose={() => setModal(null)}>
      <div className="base-form">{fields.map(f => <label key={f.id}>{f.name}{cell(currentRow,f,f.name)}</label>)}{modalFeedback}
        <div className="base-form-actions"><button onClick={() => setModal({...modal,type:'remove'})}>删除记录</button><button className="button primary" onClick={() => setModal(null)}>完成</button></div></div>
    </Dialog>}
    {modal?.type === 'field' && <FieldEditor fields={fields} existing={currentField} feedback={modalFeedback} onClose={() => setModal(null)} onSubmit={saveField} onDelete={() => setModal({...modal,type:'drop'})} />}
    {(modal?.type === 'drop' || modal?.type === 'remove') && <Dialog title={modal.type === 'drop' ? '删除此字段及其所有值？' : '删除这条记录？'} onClose={() => setModal(null)}>
      {modalFeedback}<div className="base-form-actions"><button onClick={() => setModal(null)}>取消</button><button onClick={() => {
        if (modal.type === 'drop') deleteField()
        else if (onChange(removeRecord(base,modal.row))) setModal(null)
      }}>确认删除</button></div></Dialog>}
    {modal?.type === 'exchange' && <Dialog title="多维表格导入导出" onClose={() => setModal(null)}>
      <p>JSON 保留字段、关联与视图。CSV 和 XLSX 交换显示值，导入首行为表头，XLSX 读取第一张工作表。</p>
      <div className="action-list">{['import','export'].flatMap(mode => ['json','csv','xlsx'].map(ext => <button key={mode+ext}
        onClick={() => { setModal(null); void exchange(mode,ext) }}>{mode === 'import' ? '导入' : '导出'} {ext.toUpperCase()}</button>))}</div></Dialog>}
    {modal?.type === 'import' && <Dialog title="替换当前多维表格" onClose={() => setModal(null)}>
      <p>{modal.name} 有 {modal.next.records.length} 条记录、{modal.next.fields.length} 个字段，将替换本页现有的 {records.length} 条记录。</p>
      {modalFeedback}<div className="base-form-actions"><button onClick={() => setModal(null)}>取消</button><button className="button primary"
        onClick={() => { if (onChange(modal.next) !== false) {setModal(null);setQuery('');setSort('');setLimit(100)} }}>确认导入</button></div></Dialog>}
  </div>
}
