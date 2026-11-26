import assert from 'node:assert/strict'
import test from 'node:test'
import { PDFDocument, PDFName, degrees } from 'pdf-lib'
import { appendPdfBytes, editedPdfBytes, extractPdfBytes, initialPdfPages, movePdfPage, parsePdfPageRange } from '../src/modules/pdf-edits.js'

test('PDF 整理保留原件与现有页面引用，汉字便签和旋转写入新的 PDF', async () => {
  const source=await PDFDocument.create()
  source.addPage([400,500])
  source.addPage([600,700]).setRotation(degrees(90))
  source.addPage([800,900])
  const originalBytes=await source.save()
  const recipe=movePdfPage(initialPdfPages(3),1,0).slice(0,2)
  recipe[0]={...recipe[0],rotation:90,notes:[{id:'note',text:'此处复核',x:64,y:128}]}
  const result=await PDFDocument.load(await editedPdfBytes(originalBytes,recipe))
  assert.deepEqual(result.getPages().map(p=>p.getWidth()),[600,400])
  const page=result.getPages()[0]
  assert.equal(page.getRotation().angle,180)
  const annotation=result.context.lookup(page.node.Annots().get(0))
  assert.equal(annotation.get(PDFName.of('Subtype')).toString(),'/Text')
  assert.equal(annotation.get(PDFName.of('Contents')).decodeText(),'此处复核')
  assert.equal(annotation.get(PDFName.of('P')).toString(),page.ref.toString())
  const original=await PDFDocument.load(originalBytes)
  assert.equal(original.getPageCount(),3)
  assert.equal(original.getPage(1).node.Annots(),undefined)
  for (const invalid of [[],[recipe[0],recipe[0]],[{source:9,rotation:0}]]) await assert.rejects(editedPdfBytes(originalBytes,invalid),/不一致/)
})

test('页码范围按输入顺序提取，合并使用独立 PDF，现有页面与批注保持可读', async () => {
  const base=await PDFDocument.create(), other=await PDFDocument.create()
  for(const w of [120,240,360,480,600]) base.addPage([w,700])
  other.addPage([150,300])
  other.addPage([250,300])
  const original=await base.save(), addition=await other.save()
  const draft=initialPdfPages(5)
  draft[3]={source:4,rotation:90,notes:[{id:'ref',text:'第四页',x:70,y:60}]}
  assert.deepEqual(parsePdfPageRange('4、1,2–3',5),[3,0,1,2])
  for(const invalid of ['','1,','0','1.5','4-2','6','3,2-3','1,NaN']) assert.throws(()=>parsePdfPageRange(invalid,5))
  const extract=await PDFDocument.load(await extractPdfBytes(original,draft,'4,1-2'))
  assert.deepEqual(extract.getPages().map(p=>p.getWidth()),[480,120,240])
  const page=extract.getPage(0)
  assert.equal(page.getRotation().angle,90)
  const note=extract.context.lookup(page.node.Annots().get(0))
  assert.equal(note.get(PDFName.of('P')).toString(),page.ref.toString())
  assert.equal(note.get(PDFName.of('Contents')).decodeText(),'第四页')
  const merged=await PDFDocument.load(await appendPdfBytes(original,draft,addition))
  assert.deepEqual(merged.getPages().map(p=>p.getWidth()),[120,240,360,480,600,150,250])
  assert.equal(merged.getPage(3).getRotation().angle,90)
  assert.equal((await PDFDocument.load(original)).getPageCount(),5)
  assert.equal((await PDFDocument.load(addition)).getPageCount(),2)
})
