export const fieldTypes = Object.freeze({ text: '文本', number: '数字', select: '单选', date: '日期', checkbox: '复选框', person: '人员', relation: '关联记录', formula: '公式' })
export const operations = Object.freeze({ '+': '加', '-': '减', '*': '乘', '/': '除' })
export const MAX_FIELDS = 64
export const MAX_RECORDS = 5000
export const MAX_CELL_LENGTH = 32767
export const views = ['表格', '看板', '日历']
const uid = () => crypto.randomUUID()
const validId = id => typeof id === 'string' && /^[a-z0-9-]{1,64}$/i.test(id) && !Object.hasOwn(Object.prototype, id) && id !== 'prototype'

export function emptyBase() {
  return { version: 1, fields: [
    { id: 'title', type: 'text', name: '名称' },
    { id: 'status', type: 'select', name: '状态', options: ['待开始', '进行中', '已完成'] },
    { id: 'due', type: 'date', name: '日期' },
  ], records: [], view: '表格', groupField: 'status', dateField: 'due' }
}

export function makeRecord(fields, values = {}) {
  const cells = {}
  for (const field of fields) {
    if (field.type === 'select') cells[field.id] = field.options[0] ?? ''
    if (field.type === 'checkbox') cells[field.id] = false
  }
  return { id: uid(), cells: { ...cells, ...values } }
}

export function fieldValue(record, field, recordsById, titleId) {
  const cells = record.cells
  const value = cells[field.id]
  if (field.type === 'checkbox') return value ? '是' : '否'
  if (field.type === 'relation') return value ? recordsById.get(value)?.cells[titleId] || '未命名记录' : ''
  if (field.type !== 'formula') return String(value ?? '')
  const a = cells[field.left], b = cells[field.right]
  if (a == null || a === '' || b == null || b === '') return ''
  const lhs = Number(a), rhs = Number(b)
  const result = { '+': () => lhs + rhs, '-': () => lhs - rhs, '*': () => lhs * rhs, '/': () => lhs / rhs }[field.op]()
  return Number.isFinite(result) ? String(Number(result.toPrecision(13))) : '计算错误'
}

const collator = new Intl.Collator('zh-CN', { numeric: true })

export function selectRecords(base, byId, query, sortId, descending) {
  const title = base.fields[0].id
  const needle = query.trim().toLocaleLowerCase()
  const rows = base.records.filter(r => !needle || base.fields.some(f => fieldValue(r, f, byId, title).toLocaleLowerCase().includes(needle)))
  const field = base.fields.find(f => f.id === sortId)
  if (!field) return rows
  const numeric = field.type === 'number' || field.type === 'formula'
  const values = new Map(rows.map(row => [row.id, fieldValue(row, field, byId, title)]))
  return rows.sort((a, b) => {
    const left = values.get(a.id), right = values.get(b.id)
    if (numeric) {
      const validLeft = left !== '' && Number.isFinite(Number(left)), validRight = right !== '' && Number.isFinite(Number(right))
      if (validLeft !== validRight) return validLeft ? -1 : 1
      if (validLeft) return (Number(left) - Number(right)) * (descending ? -1 : 1)
    }
    return collator.compare(left, right) * (descending ? -1 : 1)
  })
}

export function toMatrix(base) {
  const byId = new Map(base.records.map(row => [row.id, row]))
  return [base.fields.map(f => f.name), ...base.records.map(row => base.fields.map(f => fieldValue(row, f, byId, base.fields[0].id)))]
}

export function validateBase(base) {
  const fail = () => { throw new Error('多维表格备份包含无法读取的字段或记录。') }
  if (base?.version !== 1 || !views.includes(base.view) || !Array.isArray(base.fields) || !base.fields.length ||
      base.fields.length > MAX_FIELDS || base.fields[0]?.type !== 'text' || !Array.isArray(base.records) || base.records.length > MAX_RECORDS) fail()
  const fields = new Map()
  for (const f of base.fields) {
    if (!f || !validId(f.id) || fields.has(f.id) || !Object.hasOwn(fieldTypes, f.type) || typeof f.name !== 'string' || !f.name.trim()) fail()
    if (f.type === 'select' && (!Array.isArray(f.options) || !f.options.length || f.options.some(v => typeof v !== 'string' || !v.trim()) || new Set(f.options).size !== f.options.length)) fail()
    fields.set(f.id, f)
  }
  for (const f of fields.values()) {
    if (f.type === 'formula' && (!Object.hasOwn(operations, f.op) || [f.left, f.right].some(id => fields.get(id)?.type !== 'number'))) fail()
  }
  const ids = new Set()
  for (const row of base.records) {
    if (!row || !validId(row.id) || ids.has(row.id) || !row.cells || typeof row.cells !== 'object' || Array.isArray(row.cells)) fail()
    ids.add(row.id)
    for (const [key,v] of Object.entries(row.cells)) {
      const f = fields.get(key)
      if (!f || f.type === 'formula' || (f.type === 'checkbox' ? typeof v !== 'boolean' : typeof v !== 'string' || v.length > MAX_CELL_LENGTH)) fail()
      if (!v) continue
      if (f.type === 'number' && (!v.trim() || !Number.isFinite(Number(v)))) fail()
      if (f.type === 'date') {
        const date = new Date(v + 'T00:00:00Z')
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== v) fail()
      }
      if (f.type === 'select' && !f.options.includes(v)) fail()
    }
  }
  for (const row of base.records) {
    for (const f of fields.values()) if (f.type === 'relation' && row.cells[f.id] && !ids.has(row.cells[f.id])) fail()
  }
  return base
}

export function fromMatrix(rows) {
  if (!rows.length || !rows[0].length) throw new Error('文件中没有表头。')
  const width = rows.reduce((n, row) => Math.max(n, row.length), 0)
  if (width > MAX_FIELDS || rows.length - 1 > MAX_RECORDS) throw new Error('多维表支持最多 64 个字段、5000 条记录。')
  const fields = Array.from({ length: width }, (_, i) => ({ id: uid(), type: 'text', name: String(rows[0][i] ?? '').trim() || '字段 ' + (i + 1) }))
  return validateBase({ version: 1, fields, view: '表格', records: rows.slice(1).map(values => makeRecord(fields,
    Object.fromEntries(values.map((v,i) => [fields[i].id, String(v ?? '')])))) })
}

export function removeField(base, id) {
  if (id === base.fields[0].id) throw new Error('记录的名称字段必须保留。')
  if (base.fields.some(f => f.type === 'formula' && (f.left === id || f.right === id))) throw new Error('请先修改引用此字段的公式。')
  const records = base.records.map(row => {
    if (!Object.hasOwn(row.cells, id)) return row
    const cells = { ...row.cells }
    delete cells[id]
    return { ...row, cells }
  })
  const next = { ...base, fields: base.fields.filter(f => f.id !== id), records }
  if (next.groupField === id) delete next.groupField
  if (next.dateField === id) delete next.dateField
  return next
}

export function removeRecord(base, id) {
  const links = base.fields.filter(f => f.type === 'relation')
  const records = base.records.filter(r => r.id !== id).map(row => {
    const refs = links.filter(f => row.cells[f.id] === id)
    if (!refs.length) return row
    const cells = { ...row.cells }
    for (const f of refs) delete cells[f.id]
    return { ...row, cells }
  })
  return { ...base, records }
}
