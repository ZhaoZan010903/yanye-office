import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {conditionalFill,conditionRules,evaluator,filterRow,makeList,newSheet,parseRange,rangeName,replaceValidation,shiftGrid,writeRange} from '../src/modules/spreadsheet.js'
import {readXlsx,writeXlsx} from '../src/modules/spreadsheet-xlsx.js'
import {newChart,chartData} from '../src/modules/sheet-chart.js'

test('跨表查找按首列精确匹配、支持通配符与近似查找；多条件聚合校验形状，IFERROR 惰性处理',()=>{
  const sheet=newSheet('预算'),list=newSheet('价 目')
  list.cells={A1:'001',B1:'20',A2:'002',B2:'40',A3:'003',B3:'=1/0',C1:'甲',C2:'乙',C3:'甲'}
  sheet.cells={A1:"=VLOOKUP(2,'价 目'!A1:C3,2,FALSE)",A2:"=VLOOKUP(2.5,'价 目'!A1:C3,2,TRUE)",
    A3:"=VLOOKUP(2,'价 目'!A1:C3,4,FALSE)",A4:"=IFERROR(VLOOKUP(9,'价 目'!A1:C3,2,FALSE),\"缺项\")",
    A5:"=SUMIFS('价 目'!B1:B3,'价 目'!A1:A3,\"<3\",'价 目'!C1:C3,\"乙\")",
    A6:"=COUNTIFS('价 目'!C1:C3,\"甲\",'价 目'!A1:A3,\">=1\")",
    A7:"=COUNTIFS('价 目'!A1:A3,1,'价 目'!B1:C1,1)",A8:'=IFERROR(10,1/0)',A9:'=IFERROR(#N/A,"缺项")',
    A10:"=VLOOKUP(1,'价 目'!A1:C3,0,FALSE)",A11:'=IFERROR(A11,0)',A12:"=VLOOKUP(\"?\",'价 目'!C1:C3,1,FALSE)"}
  const get=evaluator({sheets:[sheet,list]})
  assert.deepEqual(Array.from({length:12},(_,i)=>get(sheet,'A'+(i+1))),[40,40,'#REF!','缺项',40,2,'#VALUE!',10,'缺项','#VALUE!','#CYCLE!','甲'])
})

test('列表验证保留大范围；选区替换仅覆盖交集；无效粘贴原子失败',()=>{
  let sheet=newSheet()
  const full=parseRange('A2:A1048576'),box=parseRange('A4:A6')
  sheet=replaceValidation(sheet,full,makeList(full,'甲，乙'))
  sheet=replaceValidation(sheet,box,makeList(box,'通过，复核'))
  assert.deepEqual(sheet.validations.map(r=>rangeName(r.box)),['A2:A3','A7:A1048576','A4:A6'])
  assert.throws(()=>writeRange(sheet,1,0,[['甲'],['出错']]),/A3/)
  assert.deepEqual(sheet.cells,{})
  const book=shiftGrid({sheets:[sheet]},sheet.id,'row',3,1)
  assert.equal(rangeName(book.sheets[0].validations[2].box),'A5:A7')
})

test('XLSX 保留筛选值、可编辑的带颜色双系列图表、条件格式和列表',async()=>{
  const sheet=newSheet("甲'表")
  sheet.cells={A1:'月份',B1:'收入',C1:'成本',A2:'三月',B2:'90',C2:'-35',A3:'四月',B3:'50',C3:'16'}
  sheet.chart=newChart(parseRange('A1:C3'))
  sheet.autoFilter={box:parseRange('A1:C3'),columns:{0:['三月']}}
  const box=parseRange('D2:D1048576')
  sheet.validations=[makeList(box,'计划，完成')]
  sheet.conditions=[{ref:'B2:C3',rules:[{type:'cellIs',operator:'greaterThan',priority:1,formulae:[60],style:{fill:{type:'pattern',bgColor:{argb:'FFFFDD55'}}}}]}]
  const display=evaluator({sheets:[sheet]})
  assert.equal(filterRow(sheet,2,display),false)
  assert.equal(conditionalFill(conditionRules(sheet),1,1,90),'#FFDD55')
  const out=await writeXlsx({sheets:[sheet]})
  const zip=await JSZip.loadAsync(out,{base64:true})
  const chart=await zip.file('xl/charts/chartYanye1.xml').async('string')
  assert.match(chart,/<c:ser>/)
  assert.match(chart,/a:srgbClr/)
  const [again]=await readXlsx(out)
  assert.deepEqual(again.validations,sheet.validations)
  assert.deepEqual(again.autoFilter,sheet.autoFilter)
  assert.deepEqual(chartData(again,evaluator({sheets:[again]})).series.map(s=>s.values),[[90,50],[-35,16]])
  assert.equal(conditionalFill(conditionRules(again),2,1,50),undefined)
})
