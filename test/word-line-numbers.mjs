import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import Zip from 'jszip'
import {createServer} from 'vite'
import {chromium} from 'playwright'

const dir=await mkdtemp(join(tmpdir(),'yanye-line-numbers-'))
const path=join(dir,'line-numbers.docx')
const fixture=`
import React from 'react'
import {createRoot} from 'react-dom/client'
import Word from '/src/modules/Word.jsx'
import {defaultLayout} from '/src/modules/word-model.js'
import {readDocx,writeDocx} from '/src/modules/word-docx.js'
const para=text=>({type:'paragraph',content:[{type:'text',text}]})
const initial={layout:defaultLayout,doc:{type:'doc',content:[para('每个段落有很多字并会自动折行。'.repeat(38)),{type:'sectionBreak',attrs:{layout:defaultLayout}},...Array.from({length:12},(_,i)=>para('第二节第'+(i+1)+'段。'))]}}
function Fixture() {
 const [value,set]=React.useState(initial)
 window.save=()=>writeDocx(value)
 window.single=()=>set({...initial,doc:{type:'doc',content:[initial.doc.content[0]]}})
 window.reload=async data=>{const model=await readDocx(data);set(model);return model}
 return React.createElement(Word,{value,onChange:set})
}
createRoot(document.querySelector('main')).render(React.createElement(Fixture))`
const server=await createServer({configFile:false,cacheDir:join(dir,'cache'),logLevel:'error',
  optimizeDeps:{entries:['src/modules/Word.jsx'],include:['react-dom/client','jszip']},server:{host:'127.0.0.1',port:0,watch:null},
  plugins:[{name:'word-lines-fixture',resolveId:id=>id==='/lines.js'?id:null,load:id=>id==='/lines.js'?fixture:null,
    configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=='/lines')return next();res.setHeader('Content-Type','text/html;charset=UTF-8')
      res.end('<!doctype html><style>main{height:97vh;display:flex}</style><main></main><script type="module" src="/lines.js"></script>')})}}]})
let browser
try {
  await server.listen();browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1280,height:800}})
  page.setDefaultTimeout(10000)
  await page.goto(server.resolvedUrls.local[0]+'lines')
  const body=page.getByRole('textbox',{name:'Word 文档正文'}),first=body.locator('p').first()
  const label=name=>page.getByLabel(name,{exact:true})
  const setInterval=async n=>{await label('行号显示间隔').fill(String(n));await label('行号显示间隔').press('Enter')}
  const marks=page.locator('.word-line-numbers span')
  const lines=()=>first.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el.firstChild);return [...range.getClientRects()].map(r=>({y:r.top,h:r.height}))})
  await page.getByRole('tab',{name:'页面',exact:true}).click()
  const before=await lines()
  assert.ok(before.length>6)
  await label('本节行号').selectOption('newSection');await setInterval(3)
  await page.waitForFunction(n=>document.querySelectorAll('.word-line-numbers span').length===n,Math.floor(before.length/3))
  assert.deepEqual(await lines(),before,'浮动行号不得改变正文换行或位置')
  await label('文档缩放').selectOption('150')
  const scaled=await lines()
  assert.equal(scaled.length,before.length)
  await page.waitForFunction(y=>Math.abs(document.querySelector('.word-line-numbers span').getBoundingClientRect().top-y)<1,scaled[2].y)
  assert.deepEqual(await marks.allTextContents(),before.filter((_,i)=>(i+1)%3===0).map((_,i)=>String((i+1)*3)))
  await page.getByRole('button',{name:'下一节',exact:true}).click()
  await label('本节行号').selectOption('newSection');await setInterval(5)
  await page.waitForFunction(()=>[...document.querySelectorAll('.word-line-numbers span')].map(x=>x.textContent).join(',')==='5,10')
  const base64=await page.evaluate(()=>window.save())
  await writeFile(path,Buffer.from(base64,'base64'))
  const xml=await (await Zip.loadAsync(base64,{base64:true})).file('word/document.xml').async('string')
  const tags=xml.match(/<w:lnNumType[^>]*\/>/g)
  assert.equal(tags.length,2);assert.ok(tags[0].includes('w:countBy="3"') && tags[1].includes('w:countBy="5"'))
  let expected='5'
  if(process.argv.includes('--native')){
    const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File','test/word-line-numbers-native.ps1',path],{encoding:'utf8',timeout:90000})
    assert.equal(result.status,0,result.error?.message || result.stderr || result.stdout)
    console.log(result.stdout.trim());expected='8'
  }
  const loaded=await page.evaluate(data=>window.reload(data),(await readFile(path)).toString('base64'))
  assert.equal(loaded.layout.nativeSection.lnNumType.attributes.countBy,expected)
  const next=page.getByRole('button',{name:'下一节',exact:true})
  if(await next.isEnabled()) await next.click()
  await label('本节行号').selectOption('off')
  const offDoc=await page.evaluate(()=>window.save())
  const off=await (await Zip.loadAsync(offDoc,{base64:true})).file('word/document.xml').async('string')
  assert.equal((off.match(/<w:lnNumType\b/g)||[]).length,1)
  await page.evaluate(()=>window.single())
  await label('本节行号').selectOption('continuous')
  await page.waitForFunction(()=>document.querySelector('.word-line-numbers span')?.textContent==='1')
  const continuous=await page.evaluate(()=>window.save())
  const single=await page.evaluate(data=>window.reload(data),continuous)
  assert.equal(single.layout.nativeSection.lnNumType.attributes.restart,'continuous')
  console.log('两节行号、自动换行、150% 缩放、间隔、关闭和 DOCX 往返通过。',path)
} finally {await browser?.close();await server.close();await rm(join(dir,'cache'),{recursive:true,force:true,maxRetries:5,retryDelay:100})}
