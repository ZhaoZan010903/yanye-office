import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceStore } from '../electron/store.mjs'
import { addPage, makePage, updatePage } from '../shared/workspace.mjs'
import { emptyBase, fieldValue, fromMatrix, makeRecord, MAX_CELL_LENGTH, MAX_FIELDS, MAX_RECORDS,
  removeField, removeRecord, selectRecords, toMatrix, validateBase, views } from '../src/modules/database.js'
import { delimitedText, parseDelimited } from '../src/modules/spreadsheet.js'

function sample() {
  const base = emptyBase()
  base.fields.push(
    { id: 'count', type: 'number', name: '数量' },
    { id: 'unit', type: 'number', name: '单价' },
    { id: 'cost', type: 'formula', left: 'count', right: 'unit', op: '*', name: '总价' },
    { id: 'author', type: 'person', name: '经手人' },
    { id: 'checked', type: 'checkbox', name: '已核对' },
    { id: 'link', type: 'relation', name: '前序' },
  )
  const a = makeRecord(base.fields, { title: '方案, "甲"', count: '3', unit: '-1.5', due: '2028-02-29', checked: true })
  const b = makeRecord(base.fields, { title: '采购', count: '5', unit: '2.125', author: '王', link: a.id })
  base.records = [a,b]
  return validateBase(base)
}

test('typed cells, relations and formulas are shared by table, board and calendar', () => {
  const base = sample(), [a,b] = base.records
  a.cells.status = '已完成'
  a.cells.unit = '-2.25'
  a.cells.title = '评审会'
  const byId = new Map(base.records.map(r => [r.id,r]))
  for (const view of views) {
    const data = validateBase({ ...base, view })
    const rows = selectRecords(data, byId, '评审会', 'cost', false)
    assert.deepEqual(rows.map(r => r.id), [a.id,b.id])
    assert.equal(rows[0].cells.due, '2028-02-29')
    assert.equal(rows[0].cells.status, '已完成')
    assert.deepEqual(toMatrix(data)[1].slice(5,9), ['-6.75','','是',''])
    assert.equal(toMatrix(data)[2].at(-1), '评审会')
  }
  a.cells.unit = ''
  const cost = base.fields.find(f => f.id === 'cost')
  assert.equal(fieldValue(a,cost,byId,'title'), '')
  assert.equal(fieldValue(b,{ ...cost, op:'/' },byId,'title'), String(Number((5 / 2.125).toPrecision(13))))
  b.cells.unit = '0'
  assert.equal(fieldValue(b,{ ...cost, op:'/' },byId,'title'), '计算错误')
})

test('typed numeric sorting is correct for signed values and decimals', () => {
  const base = sample()
  base.records = ['-2','2.11','-10','2.2',''].map(unit => makeRecord(base.fields,{ unit }))
  const byId = new Map(base.records.map(r => [r.id,r]))
  assert.deepEqual(selectRecords(base,byId,'','unit',false).map(r=>r.cells.unit), ['-10','-2','2.11','2.2',''])
  assert.deepEqual(selectRecords(base,byId,'','unit',true).map(r=>r.cells.unit), ['2.2','2.11','-2','-10',''])
})

test('field deletion protects title and formulas, record deletion clears links', () => {
  let base = sample()
  assert.throws(() => removeField(base,'unit'), /公式/u)
  assert.throws(() => removeField(base,'title'), /名称/u)
  base = removeField(removeField(removeField(base,'cost'),'unit'),'status')
  assert.equal(base.groupField, undefined)
  assert.ok(base.records.every(r=>!Object.hasOwn(r.cells,'unit')))
  const [a,b] = base.records
  base = removeRecord(base,a.id)
  assert.deepEqual(base.records.map(r=>r.id),[b.id])
  assert.ok(!Object.hasOwn(base.records[0].cells,'link'))
  validateBase(base)
})

test('native backup preserves types, CSV exchanges escaped display values up to 5000 records', () => {
  const base = sample()
  assert.deepEqual(validateBase(JSON.parse(JSON.stringify(base))),base)
  const matrix = toMatrix(base)
  const readCsv = text => parseDelimited(text, ',', MAX_RECORDS + 1)
  assert.deepEqual(toMatrix(fromMatrix(readCsv('\uFEFF' + delimitedText(matrix)))),matrix)
  const full = ['标题', ...Array(MAX_RECORDS).fill('一条记录')].join('\n')
  assert.equal(fromMatrix(readCsv(full)).records.length,MAX_RECORDS)
  assert.throws(() => readCsv(full + '\n超出'))
  assert.throws(() => fromMatrix([Array(MAX_FIELDS + 1).fill('列')]))
  assert.throws(() => fromMatrix([['标题'], ['X'.repeat(MAX_CELL_LENGTH + 1)]]))
})

test('invalid imported cells, dates and references do not produce a partial table', () => {
  for (const patch of [{ due:'2026-02-29' },{ unit:'abc' },{ checked:'是' },{ link:'missing' },
    { status:'错误状态' },{ cost:'2' }]) {
    const data = sample()
    Object.assign(data.records[0].cells,patch)
    assert.throws(() => validateBase(data))
  }
})

test('workspace save and restart retain current view, field types, record ids and edited values', async () => {
  const temp = await mkdtemp(join(tmpdir(),'yanye-db-test-'))
  try {
    const filename = join(temp,'workspace.json'), store = new WorkspaceStore(filename)
    const page = makePage({ title:'本地数据库', kind:'database' })
    const workspace = addPage(await store.load(),page)
    const content = { ...sample(), view:'日历' }
    store.stage({ ...updatePage(workspace,page.id,{content}), revision:1 })
    await store.flush()
    const reopened = await new WorkspaceStore(filename).load()
    assert.deepEqual(validateBase(reopened.pages.find(p=>p.id===page.id).content),content)
  } finally { await rm(temp,{recursive:true,force:true,maxRetries:3}) }
})
