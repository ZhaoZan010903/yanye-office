import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {address,csvText,evaluator,newSheet} from '../src/modules/spreadsheet.js'
import {readXlsx,writeXlsx} from '../src/modules/spreadsheet-xlsx.js'
import {printLayout} from '../src/modules/sheet-print.js'

const sheet=newSheet('打印样张')
Object.assign(sheet,{rows:100000,cols:2048,heights:{0:24},widths:{0:18},
  styles:{A1:{bold:true,size:14,color:'#214F76'},BTT100000:{italic:true,color:'#AA2200'}},
  pageSetup:{orientation:'landscape',paperSize:9,areas:[{top:0,left:0,bottom:131,right:3}],printTitlesRow:'1:1',showGridLines:true}})
for(let r=0;r<20000;r++) for(let c=0;c<2;c++)sheet.cells[address(r,c)]=String(10*r+c)
sheet.cells.A1='每页表头';sheet.cells.BTT100000='远端数据'
const book={sheets:[sheet],active:sheet.id}
const plan=printLayout(sheet)
assert.equal(plan.widthMm,297)
assert.ok(plan.count>=3)
assert.equal(plan.pageAt(1).rows[0],0)
assert.throws(()=>csvText(sheet,evaluator(book)),/CSV/)
if(process.argv[2]==='--seed'){
  await writeFile(process.argv[3],Buffer.from(await writeXlsx(book),'base64'))
  process.exit(0)
}
if(process.argv[2]==='--roundtrip'){
  const path=process.argv[3],sheets=await readXlsx((await readFile(path)).toString('base64'))
  const current=sheets[0]
  assert.equal(current.cells.BTT100000,'WPS 编辑')
  assert.equal(current.styles.BTT100000.color,'#AA2200')
  assert.equal(current.pageSetup.orientation,'landscape')
  assert.deepEqual(current.pageSetup.areas,[{top:0,left:0,bottom:131,right:3}])
  assert.equal(current.pageSetup.printTitlesRow.replaceAll('$',''),'1:1')
  current.cells.BTT100000='砚页回存'
  await writeFile(path,Buffer.from(await writeXlsx({sheets}),'base64'));process.exit(0)
}

process.env.NODE_ENV='production'
const {chromium}=await import('playwright'),{createServer}=await import('vite')
const harness=`import React from 'react';import {createRoot} from 'react-dom/client';import Spreadsheet from '/src/modules/Spreadsheet.jsx';
import '/src/styles.css';const root=createRoot(document.querySelector('main'));
function App({initial}){const [book,set]=React.useState(initial);window.getBook=()=>book;return React.createElement(Spreadsheet,{value:book,onChange:v=>{set(v);return true}})}
window.renderBook=b=>root.render(React.createElement(App,{initial:b}));`
const cache=await mkdtemp(join(tmpdir(),'yanye-sheet-preview-'))
const server=await createServer({mode:'production',configFile:false,cacheDir:cache,logLevel:'error',optimizeDeps:{include:['react-dom/client','exceljs','jszip']},server:{host:'127.0.0.1',port:0,watch:null},
  plugins:[{name:'large-grid',resolveId(id){if(id==='/grid-check.js')return id},load(id){if(id==='/grid-check.js')return harness},
    configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=='/grid-check')return next();res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<main style="height:100vh;display:flex;flex-direction:column;min-width:0"></main><script type="module" src="/grid-check.js"></script>')})}}]})
let browser
try{
  await server.listen();browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1440,height:900}}), errors=[]
  page.on('pageerror',e=>{errors.push(String(e));console.error(e.message)})
  await page.goto(server.resolvedUrls.local[0]+'grid-check')
  await page.waitForFunction(()=>typeof window.renderBook==='function')
  await page.evaluate(b=>window.renderBook(b),book)
  const grid=page.getByLabel('工作表网格',{exact:true}),name=page.getByLabel('名称框')
  await grid.locator('[data-address="A1"]').waitFor()
  const measure=async jump=>await grid.evaluate(async (box,jump)=>{
    box.scrollTop=0;box.scrollLeft=0
    const frames=[],raf=()=>new Promise(resolve=>requestAnimationFrame(resolve))
    let t=await raf()
    for(let i=1;i<=50;i++){
      box.scrollTop=i*(jump?23943:32);box.scrollLeft=i*(jump?1304:10)
      const next=await raf();if(i>4) frames.push(next-t);t=next
    }
    return {median:frames.sort((a,b)=>a-b)[Math.floor(frames.length*.5)],p95:frames[Math.floor(frames.length*.95)],cells:box.querySelectorAll('[data-address]').length}
  },jump)
  const continuous=await measure(false),jumps=await measure(true)
  assert.ok(continuous.cells<1500 && jumps.cells<1500)
  await name.fill('XFD1048576');await name.press('Enter')
  await grid.locator('[data-address="XFD1048576"]').waitFor()
  await grid.press('F2')
  const edit=page.getByLabel('编辑 XFD1048576')
  const editMs=await edit.evaluate(async input=>{
    const start=performance.now(),set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set
    set.call(input,'末格');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
    return performance.now()-start
  })
  const commitMs=await edit.evaluate(async input=>{const t=performance.now();input.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter'}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-t})
  assert.equal((await page.evaluate(()=>window.getBook().sheets[0].cells.XFD1048576)),'末格')
  await page.getByRole('tab',{name:'页面布局'}).click()
  await page.getByRole('button',{name:'打印预览',exact:true}).click()
  const preview=page.getByRole('dialog',{name:'打印预览'})
  await preview.locator('[data-ref="A1"]').waitFor();await preview.getByLabel('下一页').click()
  assert.equal(await preview.locator('[data-ref="A1"]').textContent(),'每页表头')
  assert.equal(await preview.locator('.sheet-print-page').getAttribute('aria-label'),'打印第 2 页')
  assert.equal(await preview.locator('table').getAttribute('data-lines'),'true')
  await page.emulateMedia({media:'print'})
  const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true})
  assert.ok(pdf.length>2000)
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,1)
  if(process.argv[2]==='--pdf')await writeFile(process.argv[3],pdf)
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({extent:'100000×2048',populated:Object.keys(sheet.cells).length,continuousMs:continuous,jumpsMs:jumps,inputPaintMs:editMs,enterCommitPaintMs:commitMs,
    farCell:'XFD1048576',previewPages:plan.count,printedPdfBytes:pdf.length}))
}finally{await browser?.close();await server.close();await rm(cache,{recursive:true,force:true})}
