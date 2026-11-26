import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs'

const cache=await mkdtemp(join(tmpdir(),'yanye-sheet-print-range-'))
const fixture=[
  "import React from 'react';import {createRoot} from 'react-dom/client';",
  "import SheetPrintPreview from '/src/modules/SheetPrintPreview.jsx';",
  "const rows=Array.from({length:60},(_,i)=>i);",
  "const sheet={name:'Print',cells:Object.fromEntries(rows.map(i=>['A'+(i+1),'ROW_'+(i+1)])),pageSetup:{areas:rows.map(i=>({top:i,bottom:i,left:0,right:0}))}};",
  "createRoot(document.querySelector('main')).render(React.createElement(SheetPrintPreview,{sheet,display:(s,r)=>s.cells[r],close:()=>{},onPrintPdf:window.capture}));"
].join('\n')
const server=await createServer({configFile:false,cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:0,watch:null},
  optimizeDeps:{include:['react-dom/client']},plugins:[{name:'print-sample',resolveId(id){if(id==='/sample.js')return id},
    load(id){if(id==='/sample.js')return fixture},configureServer(s){s.middlewares.use((req,res,next)=>{
      if(req.url!=='/print')return next()
      res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<main></main><script type="module" src="/sample.js"></script>')
    })}}]})
let browser
try{
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  let captured
  await page.exposeFunction('capture',async (name,size)=>{
    const bytes=await page.pdf({preferCSSPageSize:true,printBackground:true})
    captured={name,size,bytes}
    return true
  })
  await page.goto(server.resolvedUrls.local[0]+'print')
  const dialog=page.getByRole('dialog',{name:'打印预览'})
  await dialog.getByRole('button',{name:'打印本页',exact:true}).waitFor()
  assert.equal(await dialog.locator('.sheet-print-page').count(),1)
  await dialog.getByLabel('输出范围').selectOption('range')
  const from=dialog.getByLabel('起始页'),to=dialog.getByLabel('结束页'),pdf=dialog.getByRole('button',{name:'选定页导出 PDF'})
  await from.fill('4');await to.fill('2');await pdf.click();await dialog.getByRole('alert').getByText(/连续页码/).waitFor()
  await from.fill('1');await to.fill('51');await pdf.click();await dialog.getByRole('alert').getByText(/单次最多 50 页/).waitFor()
  await from.fill('2');await to.fill('3')
  assert.equal(await dialog.locator('.sheet-print-page').count(),1)
  await pdf.click()
  await page.waitForFunction(()=>!document.querySelector('.sheet-print-batch'))
  assert.equal(captured.name,'Print-第2-3页.pdf')
  assert.deepEqual(captured.size,{widthMm:210,heightMm:297})
  const loading=getDocument({data:new Uint8Array(captured.bytes),useSystemFonts:true,verbosity:0})
  const output=await loading.promise
  try{
    assert.equal(output.numPages,2)
    for(let i=1;i<=2;i++){
      const page=await output.getPage(i),data=await page.getTextContent()
      assert.equal(data.items.map(x=>x.str).join('').trim(),'ROW_'+(i+1))
      assert.ok(Math.abs(page.view[2]-595.3)<1 && Math.abs(page.view[3]-841.9)<1)
    }
  }finally{await loading.destroy()}
  if(process.argv[2])await writeFile(process.argv[2],captured.bytes)
  await page.evaluate(()=>{window.print=()=>{window.printReady=true}})
  await dialog.getByRole('button',{name:'打印选定页'}).click()
  await page.waitForFunction(()=>window.printReady)
  assert.equal(await dialog.locator('.sheet-print-batch article').count(),2)
  assert.ok(await from.isDisabled())
  await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')))
  await page.waitForFunction(()=>!document.querySelector('.sheet-print-batch'))
  assert.equal(await dialog.locator('.sheet-print-page').count(),1)
  assert.ok(await from.isEnabled())
  assert.deepEqual(errors,[])
  console.log('Range PDF: A4 pages 2–3 contain ROW_2 and ROW_3; batch cap, deferred mounting and afterprint cleanup passed.')
}finally{await browser?.close();await server.close();await rm(cache,{recursive:true,force:true})}
