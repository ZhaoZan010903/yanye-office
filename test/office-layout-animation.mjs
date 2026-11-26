import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {PDFDocument} from 'pdf-lib'
import JSZip from 'jszip'

const dir=resolve(process.argv[2])
const cache=await mkdtemp(join(tmpdir(),'yanye-section-animation-'))
const harness = `
import React from 'react'
import {createRoot} from 'react-dom/client'
import Word from '/src/modules/Word.jsx'
import Slides from '/src/modules/Slides.jsx'
import {readDocx,writeDocx} from '/src/modules/word-docx.js'
import {importPptx,exportPptx} from '/src/modules/slides-pptx.js'
import '/src/styles.css'
const root=createRoot(document.querySelector('main'))
function App({model,kind}){
  const [value,setValue]=React.useState(model)
  window.model=value
  return React.createElement(kind==='word'?Word:Slides,{value,title:'样本',onChange:next=>{setValue(next);return true},onPrintPdf:()=>new Promise(resolve=>{window.finishPrint=resolve})})
}
window.openFile=async(kind,base64)=>{
  const data=kind==='word'?await readDocx(base64):await importPptx(base64)
  root.render(React.createElement(App,{model:data,kind,key:kind}))
}
window.exportFile=async(kind)=>kind==='word'?writeDocx(window.model):exportPptx(window.model,'对象动画')
`
const server=await createServer({configFile:false,cacheDir:cache,logLevel:'error',optimizeDeps:{entries:['src/modules/Word.jsx','src/modules/Slides.jsx'],include:['react-dom/client','jszip','pptxgenjs']},server:{host:'127.0.0.1',port:0,watch:null},plugins:[{
  name:'section-animation-fixture',resolveId(id){if(id==='/office-sample.js')return id},
  load(id){if(id==='/office-sample.js')return harness},configureServer(server){server.middlewares.use((req,res,next)=>{
    if(req.url!=='/office-sample')return next()
    res.setHeader('Content-Type','text/html;charset=UTF-8');res.end('<!DOCTYPE html><html><body><main></main><script type="module" src="/office-sample.js"></script></body></html>')
  })}
}]})
let browser
try {
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1450,height:920}})
  page.on('pageerror',err=>console.error(err.stack))
  page.setDefaultTimeout(15000)
  await page.goto(server.resolvedUrls.local[0]+'office-sample')
  await page.waitForFunction(()=>window.openFile)
  async function open(kind,name){
    await page.evaluate(([kind,data])=>window.openFile(kind,data),[kind,(await readFile(join(dir,name))).toString('base64')])
  }
  async function save(kind,name){
    const bytes=await page.evaluate(kind=>window.exportFile(kind),kind)
    await writeFile(join(dir,name),Buffer.from(bytes,'base64'))
  }
  await open('word','native-input.docx')
  const button=name=>page.getByRole('button',{name,exact:true})
  await button('下一节').click()
  await page.getByRole('tab',{name:'页面',exact:true}).click()
  assert.equal(await page.getByLabel('纸张方向').inputValue(),'landscape')
  await page.getByLabel('本节栏数').fill('2')
  await page.getByRole('tab',{name:'插入'}).click()
  await button('页眉页脚').click()
  assert.ok(await page.getByLabel('与上一节相同').isChecked())
  assert.match(await page.getByLabel('默认页页眉').inputValue(),/合同页眉/)
  await page.getByLabel('页眉页脚位置',{exact:true}).selectOption('footer')
  await page.getByLabel('默认页页脚').fill('临时页脚')
  assert.equal(await page.getByLabel('与上一节相同').isChecked(),false)
  await page.getByLabel('与上一节相同').check()
  assert.match(await page.getByLabel('默认页页脚').inputValue(),/合同页脚/)
  await page.getByLabel('默认页页脚').fill('第二节页脚')
  await page.getByLabel('页眉页脚位置',{exact:true}).selectOption('header')
  assert.ok(await page.getByLabel('与上一节相同').isChecked())
  await page.getByRole('tab',{name:'页面',exact:true}).click()
  await button('上一节').click()
  assert.equal(await page.getByLabel('纸张方向').inputValue(),'portrait')
  await page.getByRole('tab',{name:'审阅'}).click()
  assert.equal(await page.getByRole('button',{name:'接受',exact:true}).count(),2)
  await save('word','native-roundtrip.docx')
  await page.keyboard.press('Control+p')
  await page.waitForFunction(()=>typeof window.finishPrint==='function')
  const pdf=await PDFDocument.load(await page.pdf({preferCSSPageSize:true,printBackground:true,path:join(dir,'sections.pdf')}))
  assert.equal(pdf.getPageCount(),2)
  assert.ok(pdf.getPage(0).getWidth()<pdf.getPage(0).getHeight())
  assert.ok(pdf.getPage(1).getWidth()>pdf.getPage(1).getHeight())
  await page.evaluate(()=>window.finishPrint(true))
  await button('拒绝全部修订').click()
  const body=page.getByRole('textbox',{name:'Word 文档正文'})
  assert.match(await body.innerText(),/第一节的目录/)
  await body.getByText('第一节的目录',{exact:true}).click()
  await page.keyboard.press('Home')
  await page.keyboard.insertText('LOCAL')
  await page.waitForFunction(()=>window.model.doc.content.some(p=>p.content?.some(n=>n.text?.includes('LOCAL') && n.marks?.some(m=>m.type==='wordRevision'))))
  await button('接受全部修订').click()
  await save('word','edited.docx')
  await page.getByRole('tab',{name:'页面',exact:true}).click()
  await button('插入分节符').click()
  await page.getByRole('status').filter({hasText:'跨段编辑'}).waitFor()
  assert.equal(await page.evaluate(()=>window.model.doc.content.filter(n=>n.type==='sectionBreak').length),1)
  await page.getByRole('tab',{name:'审阅'}).click()
  await page.getByLabel('记录文字修订').uncheck()
  await page.getByRole('tab',{name:'页面',exact:true}).click()
  await button('插入分节符').click()
  await page.waitForFunction(()=>window.model.doc.content.filter(n=>n.type==='sectionBreak').length===2)
  await save('word','inserted-section.docx')
  const protectedZip=await JSZip.loadAsync(await readFile(join(dir,'native-input.docx')))
  const bodyXml=await protectedZip.file('word/document.xml').async('string')
  protectedZip.file('word/document.xml',bodyXml.replace('<w:body>','<w:body><w:p><w:ins w:id="700" w:author="审阅者"><w:r><w:br/></w:r></w:ins></w:p>'))
  const protectedResult=await page.evaluate(async base64=>{
    const {readDocx,writeDocx}=await import('/src/modules/word-docx.js')
    const doc=await readDocx(base64)
    try { await writeDocx(doc);return false } catch { return doc.protectedRevisions===true }
  },await protectedZip.generateAsync({type:'base64'}))
  assert.equal(protectedResult,true,'结构修订应阻止覆盖原件')

  await open('ppt','native-input.pptx')
  await page.getByRole('tab',{name:'动画',exact:true}).click()
  const effects=await page.evaluate(()=>window.model.slides[0].animations)
  assert.deepEqual(effects.map(x=>x.effect),['appear','fade','wipe','fly','spin','motion'])
  assert.deepEqual(effects.map(x=>x.trigger),['click','with','after','click','click','click'])
  assert.ok(effects.every(x=>x.duration===750 && x.delay===250))
  await save('ppt','native-roundtrip.pptx')
  await page.getByLabel('动画效果 1',{exact:true}).selectOption('fade')
  await page.getByLabel('持续秒数 1',{exact:true}).fill('1.25')
  await page.getByLabel('持续秒数 1',{exact:true}).press('Tab')
  await page.getByLabel('水平位移百分比').fill('35')
  await page.getByLabel('水平位移百分比').press('Tab')
  await button('添加动画').click()
  await save('ppt','edited.pptx')
  await page.keyboard.press('F5')
  const first=page.locator('.slides-projector [data-animation-target]').filter({hasText:'OBJECT 1'}).first()
  await first.waitFor({state:'hidden'})
  await page.keyboard.press('ArrowRight')
  await first.waitFor({state:'visible'})
  console.log('Word 分节、修订，PPT 原始时间线、效果修改及放映步骤通过。',dir)
} finally {
  await browser?.close()
  await server.close()
  await rm(cache,{recursive:true,force:true,maxRetries:4})
}
