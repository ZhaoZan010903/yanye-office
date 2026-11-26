import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import JSZip from 'jszip'
const [file,stage]=process.argv.slice(2)
const cache=await mkdtemp(join(tmpdir(),'yanye-ref-ui-'))
const harness=`
import React from 'react'
import {createRoot} from 'react-dom/client'
import Word from '/src/modules/Word.jsx'
import {readDocx,writeDocx} from '/src/modules/word-docx.js'
const root=createRoot(document.querySelector('main'))
let sequence=0
function Sample({input}) {
  const [value,setValue]=React.useState(input)
  window.model=value
  return React.createElement(Word,{value,onChange:setValue,onPrintPdf:()=>new Promise(resolve=>window.finishPrint=resolve)})
}
window.load=async data=>root.render(React.createElement(Sample,{key:++sequence,input:data?await readDocx(data):{doc:{type:'doc',content:[{type:'paragraph'},{type:'heading',attrs:{level:1},content:[{type:'text',text:'Heading one'}]},...['Alpha book','Bravo book','Reference body'].map(text=>({type:'paragraph',content:[{type:'text',text}]}))]}}}))
window.save=()=>writeDocx(window.model)
`
const server=await createServer({configFile:false,cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:0,watch:null},optimizeDeps:{entries:['src/modules/Word.jsx'],include:['react-dom/client','jszip']},
  plugins:[{name:'word-reference-ui',resolveId(id){if(id==='/ref.js')return id},load(id){if(id==='/ref.js')return harness},
    configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=='/sample')return next();res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><style>main{height:100vh;display:flex}</style><main></main><script type="module" src="/ref.js"></script>')})}}]})
let browser
try {
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1280,height:800}})
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.setDefaultTimeout(6500)
  await page.goto(server.resolvedUrls.local[0]+'sample')
  await page.waitForFunction(()=>window.load)
  await page.evaluate(data=>window.load(data),stage==='create'?null:(await readFile(file)).toString('base64'))
  const body=page.getByRole('textbox',{name:'Word 文档正文'})
  await body.waitFor()
  const button=name=>page.getByRole('button',{name,exact:true})
  const tab=name=>page.getByRole('tab',{name,exact:true})
  assert.deepEqual(await page.getByRole('tab').allTextContents(),['开始','插入','页面','引用','审阅','视图'])
  if(stage==='create') {
    await body.getByText('Reference body').click();await page.keyboard.press('End')
    await tab('引用').click()
    for(const [kind,text] of [['脚注','First footnote'],['尾注','Endnote body']]) {
      await button('插入'+kind).click()
      await page.getByLabel(kind+'正文').fill(text)
      await button('确定').click()
    }
    await button('上一条脚注').click()
    assert.equal(await page.getByLabel('脚注正文').inputValue(),'First footnote')
    await button('取消').click()
    await body.locator('p').first().click()
    await button('插入目录').click()
    await button('更新目录').click()
    await body.locator('[data-word-toc]').getByText('Heading one').waitFor()
    await tab('页面').click()
    await page.getByLabel('左页边距（厘米）').fill('3.18')
    await page.getByLabel('左页边距（厘米）').press('Enter')
    await tab('视图').click();await button('导航窗格').click();await button('标尺').click();await button('阅读版式').click()
    assert.equal(await page.locator('.word-prose').getAttribute('contenteditable'),'false')
    await page.getByRole('navigation',{name:'标题导航'}).getByRole('button',{name:'Heading one'}).click()
    await button('页面').click()
    await tab('审阅').click();await page.getByLabel('显示修订状态').selectOption('original')
    await page.getByRole('document',{name:'修订预览'}).waitFor()
    await tab('插入').click()
    await body.getByText('Alpha book',{exact:true}).click()
    await page.keyboard.press('Home');await page.keyboard.press('Shift+ArrowDown');await page.keyboard.press('Shift+End')
    await page.waitForFunction(()=>/Alpha book\s+Bravo book/.test(window.getSelection().toString()))
    await button('书签').click();await page.getByLabel('书签名称').fill('BudgetRange');await button('添加书签').click()
    await button('定位书签').click()
    await page.waitForFunction(()=>/Alpha book\s+Bravo book/.test(window.getSelection().toString()))
    await button('关闭').click()
    await body.getByText('Reference body').click();await page.keyboard.press('End')
    await tab('引用').click();await button('交叉引用').click();await button('插入书签文字引用').click()
    await button('更新交叉引用').click()
    assert.match(await body.locator('[data-word-cross-ref]').innerText(),/Alpha book\s+Bravo book/)
    await body.locator('[data-word-cross-ref]').click({modifiers:['Control']})
    await page.waitForFunction(()=>/Alpha book\s+Bravo book/.test(window.getSelection().toString()))
    await button('导出 PDF').click()
    await page.waitForFunction(()=>window.finishPrint)
    assert.match(await page.locator('.word-print-notes').allTextContents().then(a=>a.join(' ')),/First footnote.*Endnote body/)
    await page.evaluate(()=>window.finishPrint(true))
  } else {
    const model=await page.evaluate(()=>window.model)
    assert.ok(!model.protectedNotes && !model.protectedFields,JSON.stringify(model.compatibility))
    assert.equal(await body.locator('[data-word-bookmark="BudgetRange"]').count(),2)
    assert.equal(await body.locator('[data-word-cross-ref="BudgetRange"]').count(),1)
    assert.match(await body.locator('[data-word-cross-ref="BudgetRange"]').textContent(),/Alpha book\s+Bravo book/)
    assert.equal(await body.locator('[data-word-toc]').count(),1)
    assert.equal(await body.locator('h1').count(),1)
    const note=body.locator('[data-note-kind=footnote]')
    assert.match(await note.getAttribute('title'),stage==='KWPS.Application'?/First footnote.*WPS/:/First footnote.*WPS.*Word/s)
    assert.match(await body.locator('[data-note-kind=endnote]').getAttribute('title'),/Endnote body/)
    await tab('引用').click()
    await button('更新目录').click()
  }
  await writeFile(file,Buffer.from(await page.evaluate(()=>window.save()),'base64'))
  if(stage==='Word.Application') {
    const zip=await JSZip.loadAsync(await readFile(file))
    const document=await zip.file('word/document.xml').async('string')
    assert.match(document,/w:name="_Toc[^"]+"/)
    const fields='<w:p><w:r><w:t>Adjacent text</w:t></w:r><w:fldSimple w:instr=" DATE \\@ &quot;yyyy&quot; " w:fldLock="1"><w:r><w:rPr><w:b/></w:rPr><w:t>2026</w:t></w:r></w:fldSimple>'+
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>2</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'+
      '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>8</w:t></w:r></w:fldSimple></w:p>'
    zip.file('word/document.xml',document.replace('<w:body>','<w:body>'+fields))
    await page.evaluate(raw=>window.load(raw),await zip.generateAsync({type:'base64'}))
    await body.locator('p').filter({hasText:'Adjacent text'}).click()
    await page.keyboard.press('Home');await page.keyboard.insertText('Edited ')
    assert.deepEqual(await body.locator('[data-word-text-field]').allTextContents(),['2026','2','8'])
    const edited=await JSZip.loadAsync(await page.evaluate(()=>window.save()),{base64:true})
    const serialized=await edited.file('word/document.xml').async('string')
    assert.match(serialized,/Edited Adjacent text/)
    assert.match(serialized,/w:fldLock="1"[^]*? DATE \\@ &quot;yyyy&quot; [^]*?<w:b\/>[^]*?>2026</)
    assert.match(serialized,/ PAGE [^]*?>2</);assert.match(serialized,/ NUMPAGES [^]*?>8</)
    await writeFile(join(dirname(file),'common-fields.docx'),await edited.generateAsync({type:'nodebuffer'}))
    zip.file('word/document.xml',document.replace('<w:body>','<w:body><w:p><w:fldSimple w:instr=" DATE "><w:r><w:drawing/></w:r></w:fldSimple></w:p>'))
    const protectedResult=await page.evaluate(async raw=>{
      const {readDocx,writeDocx}=await import('/src/modules/word-docx.js')
      const data=await readDocx(raw)
      try{await writeDocx(data);return false}catch{return data.protectedFields}
    },await zip.generateAsync({type:'base64'}))
    assert.ok(protectedResult)
  }
  assert.deepEqual(errors,[])
  console.log('Word ribbon and references verified:',stage)
} finally {await browser?.close();await server.close();await rm(cache,{recursive:true,force:true})}
