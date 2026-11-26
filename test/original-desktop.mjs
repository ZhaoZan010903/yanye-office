import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'
import { _electron } from 'playwright'
import { writeDocx } from '../src/modules/word-docx.js'

const root=resolve(fileURLToPath(new URL('../',import.meta.url)))
const temp=await mkdtemp(join(tmpdir(),'yanye-original-'))
const artifacts=process.env.YANYE_ORIGINAL_OUTPUT || temp
const word=await writeDocx({doc:{type:'doc',content:[{type:'paragraph',content:[
  {type:'text',text:'旧'}, {type:'text',text:'名称',marks:[{type:'bold'}]},
]}]}})
const book=new ExcelJS.Workbook()
const sheet=book.addWorksheet('明细')
sheet.getCell('A1').value={richText:[{text:'旧'},{text:'名称',font:{bold:true}}]}
sheet.getCell('A2').value={formula:'IF(A1="旧名称",1,0)',result:1}
const deck=new PptxGenJS()
deck.addSlide().addText([{text:'旧',options:{bold:true}},{text:'名称'}],{x:1,y:1,w:7,h:1})
const formats=[
  ['docx',Buffer.from(word,'base64'),'word/document.xml'],
  ['xlsx',await book.xlsx.writeBuffer(),'xl/sharedStrings.xml'],
  ['pptx',await deck.write({outputType:'nodebuffer'}),'ppt/slides/slide1.xml'],
]
let app
try {
  app=await _electron.launch({executablePath:process.argv[2]?resolve(process.argv[2]):createRequire(import.meta.url)('electron'),
    args:process.argv[2]?[]:[root],env:{...process.env,YANYE_PROFILE:join(temp,'profile')}})
  const page=await app.firstWindow()
  const errors=[]
  page.setDefaultTimeout(12000)
  page.on('pageerror',e=>errors.push(e.message))
  await page.context().setOffline(true)
  const button=name=>page.getByRole('button',{name,exact:true})
  for (const [ext,bytes,changedPart] of formats) {
    const source=join(artifacts,'版式原件.'+ext), target=join(artifacts,'版式副本.'+ext)
    const before=await JSZip.loadAsync(bytes)
    // The fixture contains an opaque part the regular editor does not model.
    before.file('customXml/item42.xml','<?xml version="1.0"?><item>旧名称</item>')
    if (ext==='docx') {
      const xml=await before.file(changedPart).async('string')
      const field='<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>REF example</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>旧名称</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'
      before.file(changedPart,xml.replace('</w:p>',field+'</w:p>'))
    }
    const original=await before.generateAsync({type:'nodebuffer'})
    await writeFile(source,original)
    await app.evaluate(({dialog},paths)=>{
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[paths.source]})
      dialog.showSaveDialog=async()=>({canceled:false,filePath:paths.target})
    },{source,target})
    await button('打开本地文件').click()
    if (ext==='docx') {
      await button('折叠工具栏').click()
      assert.equal(await page.locator('.word-tabs').isVisible(),false)
      await page.keyboard.press('Control+F1')
      await page.locator('.word-tabs').waitFor()
      await page.emulateMedia({reducedMotion:'reduce'})
      assert.equal(await button('保留版式替换').evaluate(el=>getComputedStyle(el).transitionDuration),'0s')
    }
    if (ext==='xlsx') {
      await button('返回文件中心').click()
      await button('版式原件.xlsx 的文件操作').click()
    }
    await button('保留版式替换').click()
    await page.getByLabel('查找文字',{exact:true}).fill('旧名称')
    await page.getByLabel('替换为',{exact:true}).fill('新 & 名称')
    await button('预览匹配').click()
    await page.getByText('找到 1 处',{exact:true}).waitFor()
    await button('保存替换副本').click()
    await page.getByText('已将 1 处替换写入副本。',{exact:true}).waitFor()
    await button('完成').click()
    const after=await JSZip.loadAsync(await readFile(target))
    assert.deepEqual(Object.keys(after.files).sort(),Object.keys(before.files).sort())
    for (const [name,file] of Object.entries(before.files)) {
      if (file.dir) continue
      if (name===changedPart) {
        const xml=await after.file(name).async('string')
        assert.ok(xml.includes('新 &amp; 名称'))
        if (ext==='docx') assert.ok(xml.includes('旧名称</w:t>'))
      } else assert.deepEqual(await after.file(name).async('nodebuffer'),await file.async('nodebuffer'),name)
    }
    assert.deepEqual(await readFile(source),original)
    if (ext!=='xlsx') await button('返回文件中心').click()
    console.log(ext+' · 跨格式文字替换、原件及所有其他部件字节一致')
  }
  assert.deepEqual(errors,[])
} finally {
  await app?.close()
  await rm(temp,{force:true,recursive:true,maxRetries:3})
}
