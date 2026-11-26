import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  address, bounds, changeCellStyle, copyRange, csvText, delimitedText, emptyWorkbook, evaluator, fillFrom, formatted, location, mergeRange, newSheet, parseDelimited, pasteRange, unmergeRange,
  removeSheet, renameSheet, shiftGrid, writeRange,
} from '../src/modules/spreadsheet.js'
import { appendSheets, readXlsx, writeXlsx } from '../src/modules/spreadsheet-xlsx.js'

test('conditional sums, comparisons, escaped literals and lazy IF branches', () => {
  const book=emptyWorkbook(), sheet=book.sheets[0]
  sheet.cells = { A1:'材料', A2:'材料费', A3:'服务', B1:'3', B2:'7', B3:'-2', B4:'未定',
    C1:'=IF(SUM(B1:B3)>5,"可""用",1/0)', C2:'=IF(FALSE,C2,9)',
    C3:'=SUMIF(A1:A3,"材料*",B1:B3)', C4:'=COUNTIF(B1:B4,">0")', C5:'=COUNTA(B1:B8)',
    C6:'=COUNTIF(B1:B4,">="&B1)', C7:'=IF(B3<0,"亏","盈")' }
  const value=evaluator(book)
  assert.deepEqual(Array.from({length:7},(_,i)=>value(sheet,'C'+(i+1))), ['可"用',9,10,2,4,2,'亏'])
})

test('rectangular paste translates formulas, preserves relative and absolute addresses and formats', () => {
  let sheet=writeRange(newSheet(),0,0,[['3','=A1+$A$1'],['4','=A2']])
  sheet=changeCellStyle(sheet,[0,1],0,1,{bold:true,fill:'#FEEDAC',numberFormat:'number'})
  const result=pasteRange(sheet,3,2,copyRange(sheet,[0,1],0,1))
  assert.equal(result.cells.D4,'=C4+$A$1')
  assert.equal(result.cells.D5,'=C5')
  assert.deepEqual(result.styles.C4,{bold:true,fill:'#FEEDAC'})
  assert.equal(result.formats.D5,'number')
  assert.equal(sheet.cells.D4,undefined)
})

test('merging checks data and overlap, structured edits track ranges and XLSX retains cell styling', async () => {
  const book=emptyWorkbook()
  let sheet=changeCellStyle(book.sheets[0],[1],1,1,{bold:true,italic:true,font:'宋体',size:18,color:'#224466',fill:'#DDFFFF',align:'center'})
  sheet.widths={1:24.5}
  sheet.heights={1:44}
  sheet=writeRange(sheet,1,1,[['标题','保留']])
  const box=bounds({row:1,col:1},{row:3,col:3})
  assert.throws(()=>mergeRange(sheet,box),/含有数据/)
  sheet=mergeRange(writeRange(sheet,1,2,[['']]),box)
  assert.throws(()=>mergeRange(sheet,box),/已有合并/)
  assert.throws(()=>writeRange(sheet,2,3,[['隐藏的值']]),/已合并/)
  assert.equal(unmergeRange(sheet,box).merges.length,0)
  book.sheets[0]=sheet
  const changed=shiftGrid(book,sheet.id,'row',0,1)
  assert.deepEqual(changed.sheets[0].merges,[{top:2,left:1,bottom:4,right:3}])
  changed.sheets[0]=changeCellStyle(changed.sheets[0],[7],7,7,{fill:'#112233',numberFormat:'percent'})
  changed.sheets[0].freezeHeader=true
  const [loaded]=await readXlsx(await writeXlsx(changed))
  assert.deepEqual(loaded.merges,changed.sheets[0].merges)
  assert.deepEqual(loaded.styles.B3,sheet.styles.B2)
  assert.equal(loaded.styles.H8.fill,'#112233')
  assert.equal(loaded.widths[1],24.5)
  assert.equal(loaded.heights[2],44)
  assert.equal(loaded.formats.H8,'percent')
  assert.equal(loaded.freezeHeader,true)
})

test('formulas recalculate dependencies, quoted sheets, ranges and cycle errors', () => {
  const book = emptyWorkbook(), sheet = book.sheets[0], costs = newSheet("投入'成本")
  book.sheets.push(costs)
  costs.cells = { B1:'3', B2:'7', B3:'总计' }
  sheet.cells = { A1:"=SUM('投入''成本'!$B$1:B3)", B1:'=A1*2+ROUND(2.55,1)', C1:'=C2', C2:'=C1', D1:'=3/0', E1:'=NOPE(A1)', F1:'=123456789012345+1' }
  let value = evaluator(book)
  assert.equal(value(sheet,'A1'),10)
  assert.equal(value(sheet,'B1'),22.6)
  assert.equal(value(sheet,'C1'),'#CYCLE!')
  assert.equal(value(sheet,'D1'),'#DIV/0!')
  assert.equal(value(sheet,'E1'),'#NAME?')
  assert.equal(value(sheet,'F1'),123456789012346)
  costs.cells.B2='10'
  value = evaluator(book)
  assert.equal(value(sheet,'A1'),13)
  const renamed = renameSheet(book,costs.id,'项目成本')
  assert.equal(renamed.sheets[0].cells.A1,"=SUM('项目成本'!$B$1:B3)")
})

test('structural edits preserve references, range endpoints, other sheet names and absolute addresses', () => {
  const book = emptyWorkbook(), sheet = book.sheets[0]
  sheet.cells = { A1:'2', A2:'3', A3:'4', C4:'=SUM($A$1:A3)', D4:'=A1' }
  const remote = newSheet('外部'); remote.cells = { A1:'=工作表1!A2' }; book.sheets.push(remote)
  const after = shiftGrid(book,sheet.id,'row',0,-1)
  assert.equal(after.sheets[0].cells.C3,'=SUM($A$1:A2)')
  assert.equal(after.sheets[0].cells.D3,'=#REF!')
  assert.equal(evaluator(after)(after.sheets[1],'A1'),3)
  const again = shiftGrid(after,sheet.id,'col',0,1)
  assert.equal(again.sheets[0].cells.D3,'=SUM($B$1:B2)')
  assert.equal(evaluator(again)(again.sheets[0],'D3'),7)
  assert.equal(address(99, 26),'AA100')
  assert.equal(location('HX200').col,231)
})

test('CSV and TSV preserve quotes, commas, CRLF and empty trailing fields', () => {
  const rows = [['事项','费用','说明'],['包含,逗号','3','"quoted"\r\nnext'],['乙','0','']]
  assert.deepEqual(parseDelimited('\uFEFF'+delimitedText(rows)),rows)
  assert.deepEqual(parseDelimited(delimitedText(rows,'\t'),'\t'),rows)
  assert.throws(()=>parseDelimited('"unterminated'),/引号/)
  const book = emptyWorkbook()
  book.sheets[0] = writeRange(book.sheets[0],0,0,[['项目','金额'],['甲','12'],['乙','=B2*2']])
  assert.equal(csvText(book.sheets[0],evaluator(book)),'项目,金额\r\n甲,12\r\n乙,24')
})

test('fill updates relative references and keeps absolute cells and number formats', () => {
  const book = emptyWorkbook(), other = newSheet('备份'), sheet = book.sheets[0]
  sheet.cells = { A1:'2',B1:'3',A2:'=$A1+$B$1' }; sheet.formats = {A2:'percent'}
  book.sheets.push(other); other.cells = {A1:'=工作表1!A2'}
  const copied = fillFrom(sheet,1,1,'right')
  assert.equal(copied.cells.B2,'=$A1+$B$1')
  assert.equal(copied.formats.B2,'percent')
  assert.equal(fillFrom(copied,2,1,'down').cells.B3,'=$A2+$B$1')
  assert.equal(formatted(0.45,'percent'),'45%')
  assert.equal(removeSheet(book,sheet.id).sheets[0].cells.A1,'=#REF!')
})

test('XLSX round trip retains sheet identities, numeric results, leading-zero text and formulas', async () => {
  const book = emptyWorkbook(), sheet = book.sheets[0], report = newSheet('汇总')
  sheet.cells = { A1:"'001", B1:'3', B2:'14' }; sheet.formats = {B1:'currency', B2:'number'}
  report.cells = { A1:'=SUM(工作表1!B1:B2)' }; book.sheets.push(report)
  const binary = await writeXlsx(book)
  assert.equal(atob(binary).slice(0,2),'PK')
  const imported = await readXlsx(binary)
  const combined = appendSheets(emptyWorkbook(),imported)
  assert.equal(combined.sheets[1].name,'工作表1 (2)')
  assert.equal(combined.sheets[1].cells.A1,"'001")
  assert.deepEqual(combined.sheets[1].formats,{B1:'currency',B2:'number'})
  assert.equal(evaluator(combined)(combined.sheets[2],'A1'),17)
  await assert.rejects(readXlsx(btoa('not-a-workbook')),/XLSX/)
})
