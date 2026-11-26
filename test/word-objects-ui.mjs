import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import JSZip from 'jszip'
const [file,stage='create']=process.argv.slice(2)
const cache=await mkdtemp(join(tmpdir(),'yanye-word-objects-ui-'))
const harness=[
  "import React from 'react';import {createRoot} from 'react-dom/client';",
  "import Word from '/src/modules/Word.jsx';import {readDocx,writeDocx} from '/src/modules/word-docx.js';",
  "const root=createRoot(document.querySelector('main'));window.exports={};",
  "function Sample({input}){const [value,setValue]=React.useState(input);window.model=value;return React.createElement(Word,{value,onChange:setValue,title:'Letters',onExport:(key,v)=>window.exports[key]=v})}",
  "window.load=async raw=>root.render(React.createElement(Sample,{input:raw?await readDocx(raw):{doc:{type:'doc',content:['Original body','Anchor','Equation','Dear '].map(text=>({type:'paragraph',content:[{type:'text',text}]}))}}}));",
  "window.save=()=>writeDocx(window.model);window.revised=()=>{const v=structuredClone(window.model);v.doc.content[0].content[0].text='Revised body';return writeDocx(v)}"
].join('\n')
const server=await createServer({configFile:false,cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:0,watch:null},
  optimizeDeps:{entries:['src/modules/Word.jsx'],include:['react-dom/client','jszip']},plugins:[{name:'word-objects-test',resolveId(id){if(id==='/objects.js')return id},
  load(id){if(id==='/objects.js')return harness},configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=='/sample')return next()
  res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<main></main><script type="module" src="/objects.js"></script>')})}}]})
let browser
try{
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[]
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)})
  page.setDefaultTimeout(6500)
  await page.goto(server.resolvedUrls.local[0]+'sample')
  await page.waitForFunction(()=>window.load)
  await page.evaluate(data=>window.load(data),stage==='create'?null:(await readFile(file)).toString('base64'))
  const body=page.getByRole('textbox',{name:'Word 文档正文'})
  await body.waitFor()
  const button=name=>page.getByRole('button',{name,exact:true}),tab=name=>page.getByRole('tab',{name,exact:true})
  if(stage==='create'){
    await tab('插入').click()
    await body.getByText('Anchor',{exact:true}).click();await page.keyboard.press('End')
    await button('文本框').click()
    await page.getByLabel('文本框内容').fill('Floating note')
    await page.getByLabel('文本框水平偏移').fill('210')
    await page.getByLabel('文本框垂直偏移').fill('12')
    await page.getByLabel('文本框宽度').fill('160');await button('插入文本框').click()
    await body.getByRole('img',{name:'文本框 Floating note'}).waitFor()
    await body.getByText('Equation',{exact:true}).click({position:{x:6,y:8}});await page.keyboard.press('End');await button('公式').click()
    await page.getByLabel('公式输入').fill('\\frac{x_{i}^{2}}{\\sqrt{y}}');await button('插入公式').click()
    assert.equal(await body.locator('math mfrac').count(),1)
    await body.getByText('Dear',{exact:true}).click({position:{x:5,y:8}});await page.keyboard.press('End')
    await tab('引用').click();await button('邮件合并').click()
    await page.getByLabel('收件人数据').setInputFiles({name:'local.csv',mimeType:'text/csv',buffer:Buffer.from('Name,City\n林岚,苏州\n"Li, Li",北京')})
    await button('插入合并域').click();await button('预览结果').click()
    assert.match(await page.getByLabel('合并预览').innerText(),/林岚/)
    await button('合并全部记录').click()
    await page.waitForFunction(()=>Object.keys(window.exports).length===1)
    const letters=Object.values(await page.evaluate(()=>window.exports))[0]
    await writeFile(join(dirname(file),'letters.docx'),Buffer.from(letters,'base64'))
    const zip=await JSZip.loadAsync(letters,{base64:true}),doc=await zip.file('word/document.xml').async('string')
    assert.match(doc,/林岚/);assert.match(doc,/Li, Li/);assert.doesNotMatch(doc,/MERGEFIELD/);assert.equal((doc.match(/<w:sectPr>/g)||[]).length,2)
    await button('关闭邮件合并').click()
    await tab('审阅').click();await button('比较文档').click()
    const compare=async data=>page.getByLabel('修订稿',{exact:true}).setInputFiles({name:'second.docx',mimeType:'application/octet-stream',buffer:Buffer.from(data,'base64')})
    await compare(await page.evaluate(()=>window.save()));await page.getByText('second.docx · 0 处差异').waitFor()
    await compare(await page.evaluate(()=>window.revised()));await page.getByText('second.docx · 1 处差异').waitFor()
    await button('导出对照表').click();await page.waitForFunction(()=>window.exports['文档比较结果.docx'])
    await button('导出带修订副本').click();await page.waitForFunction(()=>window.exports['文档比较修订稿.docx'])
    for(const [k,name] of [['文档比较结果.docx','report.docx'],['文档比较修订稿.docx','tracked.docx']]){
      await writeFile(join(dirname(file),name),Buffer.from(await page.evaluate(k=>window.exports[k],k),'base64'))
    }
  } else {
    const model=await page.evaluate(()=>window.model)
    assert.ok(!model.protectedFields,JSON.stringify(model.compatibility))
    const box=body.locator('[data-word-textbox]')
    assert.equal(await box.count(),1,JSON.stringify(model.compatibility))
    assert.equal(await body.locator('math mfrac').count(),1,JSON.stringify(model.compatibility))
    assert.match(await body.locator('[data-word-text-field]').innerText(),/Name/)
    const data=model.doc.content.flatMap(p=>p.content||[]).find(n=>n.type==='wordTextBox').attrs
    assert.ok(Math.abs(data.x-210)<.1 && Math.abs(data.width-160)<.1,JSON.stringify([data.x,data.width]))
    assert.ok(data.text.includes('Floating note'))
    const nativeText=await body.innerText()
    assert.match(nativeText,/WPS/)
    if(stage==='word')assert.match(nativeText,/Word/)
    await tab('插入').click()
    await box.locator('.word-float-frame').dblclick()
    await page.getByLabel('文本框内容').fill(data.text+' 砚页');await button('应用修改').click()
  }
  await writeFile(file,Buffer.from(await page.evaluate(()=>window.save()),'base64'))
  assert.deepEqual(errors,[])
  console.log('Word objects and workflows passed:',stage)
}finally{await browser?.close();await server.close();await rm(cache,{recursive:true,force:true})}
