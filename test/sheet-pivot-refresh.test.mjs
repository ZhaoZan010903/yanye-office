import test from 'node:test'
import assert from 'node:assert/strict'
import { newSheet } from '../src/modules/spreadsheet.js'
import { createPivot } from '../src/modules/sheet-pivot.js'
import { refreshReports } from '../src/modules/sheet-pivot-refresh.js'

test('refreshing reports respects source order and a failure leaves the original workbook intact',()=>{
  const sales=newSheet('明细')
  sales.cells={A1:'地区',B1:'金额',A2:'东',B2:'10',A3:'西',B3:'20'}
  const config={ref:'A1:B3',rowField:0,dataField:1,summary:'sum'}
  const first=createPivot({sheets:[sales]},sales,config)
  const detail=first.sheets[1]
  const second=createPivot(first,detail,config)
  const summary=second.sheets[2]
  const edited={...sales,cells:{...sales.cells,B2:'15'}}
  const book={sheets:[summary,detail,edited]}
  const one=refreshReports(book,detail.id)
  assert.equal(one.sheets[0],summary)
  assert.equal(one.sheets[1].cells.B4,'35')
  assert.equal(refreshReports(book).sheets[0].cells.B4,'35')
  assert.equal(book.sheets[1].cells.B4,'30')
  const loop={...detail,pivot:{...detail.pivot,sourceId:summary.id}}
  assert.throws(()=>refreshReports({sheets:[summary,loop,edited]}),/互相引用/)
})
