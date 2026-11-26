import assert from 'node:assert/strict'
import test from 'node:test'
import {newSheet} from '../src/modules/spreadsheet.js'
import {createPivot,refreshPivot} from '../src/modules/sheet-pivot.js'
import {readXlsx,writeXlsx} from '../src/modules/spreadsheet-xlsx.js'

test('hierarchies, column totals, typed zero/blank selections, and removed slicer members survive refresh',async()=>{
  const data=newSheet('明细')
  const records=[['组','成员','季度','金额','类别'],['东','甲','Q1',10,0],['东','甲','Q2',20,''],['东','乙','Q1',90,0],['西','丙','Q1',8,'x']]
  records.forEach((vals,r)=>vals.forEach((v,c)=>{if(v!=='') data.cells[String.fromCharCode(65+c)+(r+1)]=String(v)}))
  const config={ref:'A1:E5',rowFields:[0,1],columnField:2,dataField:3,summary:'average',layout:'compact',slicers:[{field:4,selected:[0]}]}
  const initial=createPivot({sheets:[data]},data,config), pivot=initial.sheets[1]
  assert.equal(pivot.cells.C6,'50')
  assert.ok(pivot.styles.A4.indent>0)
  const blank=refreshPivot(initial,{...pivot,pivot:{...pivot.pivot,slicers:[{field:4,selected:['']}]}})
  assert.equal(blank.cells.C5,'20')
  const reopened=await readXlsx(await writeXlsx(initial))
  assert.equal(reopened[1].pivot.layout,'compact')
  assert.deepEqual(reopened[1].pivot.slicers[0].selected,[0])
  data.cells.E2='新';data.cells.E4='新'
  const updated=refreshPivot(initial,pivot)
  assert.equal(updated.pivot.slicers[0].selected,null)
  assert.equal(updated.cells.D8,'32')
})
