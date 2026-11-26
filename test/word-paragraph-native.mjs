import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import {chromium} from 'playwright'

// Run by word-paragraph-native.ps1 on a newly created, disposable file.
const path=resolve(process.argv[2]), stage=process.argv[3], source=await readFile(path)
const cache=await mkdtemp(join(tmpdir(),'yanye-word-revisions-ui-'))
const harness=`
import React from 'react'
import {createRoot} from 'react-dom/client'
import Word from '/src/modules/Word.jsx'
import {readDocx,writeDocx} from '/src/modules/word-docx.js'
const root=createRoot(document.querySelector('main'))
function Sample({input}) {
  const [value,update]=React.useState(input)
  window.sample=value
  return React.createElement(Word,{value,title:'跨段校样',onChange:newValue=>{update(newValue);return true},
    onPrintPdf:()=>new Promise(resolve=>{window.closePrint=resolve})})
}
window.load=async raw=>root.render(React.createElement(Sample,{input:await readDocx(raw)}))
window.save=()=>writeDocx(window.sample)
`
const server=await createServer({configFile:false,cacheDir:cache,logLevel:'error',
  server:{host:'127.0.0.1',port:0,watch:null},optimizeDeps:{entries:['src/modules/Word.jsx'],include:['react-dom/client','jszip']},
  plugins:[{name:'word-cross-paragraph',resolveId(id){if(id==='/revision-sample.js')return id},
    load(id){if(id==='/revision-sample.js')return harness},configureServer(s){s.middlewares.use((req,res,next)=>{
      if(req.url!=='/sample')return next()
      res.setHeader('Content-Type','text/html;charset=utf-8')
      res.end('<!doctype html><html><body><main></main><script type="module" src="/revision-sample.js"></script></body></html>')
    })}}]})
let browser
try {
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage()
  page.on('pageerror',e=>console.error(e.stack))
  await page.goto(server.resolvedUrls.local[0]+'sample')
  await page.waitForFunction(()=>window.load)
  await page.evaluate(raw=>window.load(raw),source.toString('base64'))
  const body=page.getByRole('textbox',{name:'Word 文档正文'})
  await body.waitFor()
  const initial=await page.evaluate(()=>window.sample)
  assert.ok(!initial.protectedRevisions,JSON.stringify(initial.compatibility))
  await page.getByRole('tab',{name:'审阅'}).click()
  const reject=page.getByRole('button',{name:'拒绝全部修订'})
  const names=()=>body.locator('p').allTextContents()
  if(stage==='rejected') {
    assert.deepEqual(await names(),['AlphaOne','BravoTwo','CharlieEnd'])
    assert.equal(await body.locator('[data-break-revision],ins,del').count(),0)
  } else if(stage==='individual') {
    const pane=page.getByRole('region',{name:'文字修订'})
    const rows=pane.locator('ol li')
    assert.equal(await rows.count(),2)
    await page.getByRole('button',{name:'导出 PDF'}).click()
    await page.waitForFunction(()=>window.closePrint)
    assert.deepEqual(await page.locator('.word-print-root section p').allTextContents(),['AlphaFirst','SecondTwo','CharlieEnd'])
    await page.evaluate(()=>window.closePrint(true))
    await rows.last().getByRole('button',{name:'拒绝',exact:true}).click()
    assert.equal(await rows.count(),1)
    await rows.first().getByRole('button',{name:'拒绝',exact:true}).click()
    assert.deepEqual(await names(),['AlphaOne','BravoTwo','CharlieEnd'])
  } else {
    await body.locator('[data-break-revision]').first().waitFor()
    await reject.click()
    if(stage==='foreign-format') {
      assert.deepEqual(await names(),['AAA','BBB','CCC'])
      assert.deepEqual(await page.evaluate(()=>window.sample.doc.content.map(p=>p.attrs?.align||'left')),['left','center','right'])
    } else {
      assert.deepEqual(await names(),['AlphaOne','BravoTwo','CharlieEnd'])
      await body.focus()
      await body.evaluate(area=>{
        const p=area.querySelectorAll('p')
        function at(block,offset) {
          const w=document.createTreeWalker(block,NodeFilter.SHOW_TEXT)
          while(w.nextNode()){if(offset<=w.currentNode.length)return [w.currentNode,offset];offset-=w.currentNode.length}
          throw Error('找不到跨段选区')
        }
        const range=new Range()
        range.setStart(...at(p[0],5));range.setEnd(...at(p[1],5))
        window.getSelection().removeAllRanges();window.getSelection().addRange(range)
      })
      // The normal paste handler creates a real open ProseMirror slice.
      await body.evaluate(area=>{
        const data=new DataTransfer();data.setData('text/plain','First\nSecond')
        area.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))
      })
      await body.locator('[data-break-revision="ins"]').first().waitFor()
      assert.ok(await body.locator('[data-break-revision="del"]').count()>0)
      await page.getByRole('button',{name:'接受全部修订'}).click()
      assert.deepEqual(await names(),['AlphaFirst','SecondTwo','CharlieEnd'])
      await body.press('Control+z')
      await body.locator('[data-break-revision="ins"]').first().waitFor()
    }
    await writeFile(path,Buffer.from(await page.evaluate(()=>window.save()),'base64'))
  }
  console.log('砚页跨段校样已核对',stage)
} finally {
  await browser?.close(); await server.close()
  await rm(cache,{recursive:true,force:true,maxRetries:4})
}
