import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  address, csvText, delimitedText, emptyWorkbook, evaluator, fillFrom, formatted, location, newSheet, parseDelimited,
  removeSheet, renameSheet, shiftGrid, writeRange,
} from '../src/modules/spreadsheet.js'
import { appendSheets, readXlsx, writeXlsx } from '../src/modules/spreadsheet-xlsx.js'

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
