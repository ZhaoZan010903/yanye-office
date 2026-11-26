import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {utils,write} from 'cfb'
import {newSheet,evaluator,removeSheet} from '../src/modules/spreadsheet.js'
import {readXlsx,writeXlsx} from '../src/modules/spreadsheet-xlsx.js'
import {createPivot,refreshPivot} from '../src/modules/sheet-pivot.js'
import {patchWorkbook} from '../src/modules/preserved-workbook.js'
import {vbaProject,decompressVba} from '../src/modules/vba-reader.js'
import {readOfficeFile,writeOfficeFile} from '../src/office-files.js'

function sample() {
  const source=newSheet('明细')
  source.cells={A1:'地区',B1:'金额',A2:'东',B2:'20',A3:'西',B3:'30',A4:'东',B4:'15',D2:'=B2*2'}
  source.styles={B2:{bold:true}}
  return {source,book:{sheets:[source],active:source.id}}
}

test('VBA honors the module offset and project code page and keeps protected projects opaque',()=>{
  const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b}
  const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b}
  const rec=(id,payload=Buffer.alloc(0))=>Buffer.concat([u16(id),u32(payload.length),payload])
  function literals(input) {
    const groups=[]
    for(let at=0;at<input.length;at+=8) groups.push(Buffer.from([0]),input.subarray(at,at+8))
    const chunk=Buffer.concat(groups)
    return Buffer.concat([Buffer.from([1]),u16(0xb000+chunk.length-1),chunk])
  }
  const dir=Buffer.concat([rec(1,u32(1)),rec(2,u32(0x409)),rec(0x14,u32(0x409)),rec(3,u16(936)),
    rec(0x0f,u16(1)),rec(0x13,u16(0)),rec(0x19,Buffer.from('Budget')),rec(0x1a,Buffer.from('Budget')),
    rec(0x32,Buffer.from('Budget','utf16le')),rec(0x31,u32(4)),rec(0x21),rec(0x2b),rec(0x10)])
  function project(password) {
    const c=utils.cfb_new()
    utils.cfb_add(c,'PROJECT',Buffer.from(['Module=Budget','CMG="0705D8E3D8EDDBF1DBF1DBF1DBF1"',
      password,'GC="1517CAF1D6F9D7F9D706"'].join('\r\n')))
    utils.cfb_add(c,'VBA/dir',literals(dir))
    utils.cfb_add(c,'VBA/Budget',Buffer.concat([Buffer.alloc(4),literals(Buffer.from([39,32,0xd6,0xd0,0xce,0xc4]))]))
    return vbaProject(write(c,{type:'buffer'}))
  }
  const opened=project('DPB="0E0CD1ECDFF4E7F5E7F5E7"')
  assert.equal(opened.codepage,936)
  assert.equal(opened.source('Budget'),"' 中文")
  const protectedProject=project('DPB="0000"')
  assert.equal(protectedProject.sourceState,'protected')
  assert.throws(()=>protectedProject.source('Budget'),/未开放/)
  assert.throws(()=>decompressVba(Buffer.from([1,2,0xb0,1,0,0])),/无效/)
})
test('editable PivotTable fields and cache records survive XLSX save and reopen',async()=>{
  const {source,book}=sample()
  const grouped=createPivot(book,source,{ref:'A1:B4',rowField:0,dataField:1,summary:'sum'})
  const sheet=grouped.sheets[1]
  assert.equal(evaluator(grouped)(sheet,'B4'),65)
  assert.throws(()=>removeSheet(grouped,source.id),/数据源/)
  const sheets=await readXlsx(await writeXlsx(grouped))
  assert.equal(sheets[1].pivot.sourceId,sheets[0].id)
  sheets[0].cells.B2='25'
  sheets[1]=refreshPivot({sheets},{...sheets[1],pivot:{...sheets[1].pivot,summary:'average',caption:null}})
  const zipped=await writeXlsx({sheets})
  const opened=await readXlsx(zipped)
  assert.equal(evaluator({sheets:opened})(opened[1],'B2'),20)
  assert.equal(opened[1].pivot.summary,'average')
  const zip=await JSZip.loadAsync(zipped,{base64:true})
  assert.match(await zip.file('xl/pivotCache/pivotCacheRecords1.xml').async('string'),/<n v="25"/)
  assert.throws(()=>createPivot(book,source,{ref:'A1:XFD2',rowField:0,dataField:1,summary:'sum'}),/超出/)
  zip.file('xl/slicerCaches/slicerCache1.xml','<slicerCacheDefinition/>')
  const advanced=await zip.generateAsync({type:'base64'})
  const page=await readOfficeFile({extension:'xlsx',content:advanced})
  assert.ok(page.content.preserved)
  const edits={明细:{B3:'125'}}
  const after=await JSZip.loadAsync(await patchWorkbook(Buffer.from(advanced,'base64'),edits))
  for(const part of ['xl/slicerCaches/slicerCache1.xml','xl/pivotTables/pivotTable1.xml','xl/pivotCache/pivotCacheDefinition1.xml'])
    assert.deepEqual(await after.file(part).async('uint8array'),await zip.file(part).async('uint8array'))
  await assert.rejects(patchWorkbook(Buffer.from(advanced,'base64'),{[opened[1].name]:{B2:'8'}}),/保留|透视/)
})

test('XLSM constant edits preserve every unrelated part, VBA bytes, formulas and cell formatting',async()=>{
  const {book}=sample(), zip=await JSZip.loadAsync(await writeXlsx(book),{base64:true})
  const container=utils.cfb_new()
  utils.cfb_add(container,'PROJECT',Buffer.from('Module=Budget\r\nName="BudgetProject"\r\n'))
  const project=Buffer.from(write(container,{type:'buffer'}))
  zip.file('xl/vbaProject.bin',project)
  const rel='xl/_rels/workbook.xml.rels'
  zip.file(rel,(await zip.file(rel).async('string')).replace('</Relationships>',
    '<Relationship Id="rIdVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>'))
  const ct='[Content_Types].xml'
  zip.file(ct,(await zip.file(ct).async('string')).replace('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    'application/vnd.ms-excel.sheet.macroEnabled.main+xml').replace('</Types>','<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>'))
  const bytes=await zip.generateAsync({type:'uint8array'})
  const file={extension:'xlsm',content:Buffer.from(bytes).toString('base64')}
  const {content}=await readOfficeFile(file)
  assert.equal(content.preserved.project.modules[0].name,'Budget')
  content.preserved.edits={明细:{B2:'42',C2:'含<&>和空格 ',Z100:'新行'}}
  const encoded=await writeOfficeFile({kind:'spreadsheet',disk:{extension:'xlsm',id:'a',revision:'b'},content},async(id,rev)=>{
    assert.equal(id,'a');assert.equal(rev,'b');return bytes
  })
  const after=await JSZip.loadAsync(encoded,{base64:true})
  assert.deepEqual(Object.keys(after.files).sort(),Object.keys(zip.files).sort())
  for(const name of Object.keys(zip.files).filter(n=>!zip.files[n].dir && !['xl/workbook.xml','xl/worksheets/sheet1.xml'].includes(n))) {
    assert.deepEqual(await after.file(name).async('uint8array'),await zip.file(name).async('uint8array'), name)
  }
  const [sheet]=await readXlsx(encoded)
  assert.equal(sheet.cells.B2,'42')
  assert.equal(sheet.styles.B2.bold,true)
  assert.equal(sheet.cells.C2,'含<&>和空格 ')
  assert.equal(sheet.cells.D2,'=B2*2')
  assert.equal(sheet.cells.Z100,'新行')
  await assert.rejects(patchWorkbook(bytes,{明细:{D2:'8'}}),/公式/)
  assert.equal(await patchWorkbook(bytes,{}),bytes)
})
