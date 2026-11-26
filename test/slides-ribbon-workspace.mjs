import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {createServer} from 'vite'
import {chromium} from 'playwright'

const dir=await mkdtemp(join(tmpdir(),'yanye-slides-ribbon-'))
const file=join(dir,'演示功能区校样.pptx')
const fixture=`
import React from 'react'
import {createRoot} from 'react-dom/client'
import Slides from '/src/modules/Slides.jsx'
import {exportPptx,importPptx} from '/src/modules/slides-pptx.js'
import '/src/styles.css'
function Fixture(){
  const [deck,set]=React.useState({theme:'paper',slides:[{id:'first',layout:'columns',title:'标题校样',body:'起草\\n复核',side:'右栏校样',notes:''}]})
  window.saveDeck=()=>exportPptx(deck,'演示功能区校样')
  window.loadDeck=async data=>{const round=await importPptx(data);set(round);return round.slides[0]}
  return React.createElement(Slides,{value:deck,onChange:set})
}
createRoot(document.querySelector('main')).render(React.createElement(Fixture))`
const server=await createServer({configFile:false,cacheDir:join(dir,'cache'),logLevel:'error',
  optimizeDeps:{entries:['src/modules/Slides.jsx'],include:['react-dom/client','jszip','pptxgenjs']},server:{host:'127.0.0.1',port:0,watch:null},
  plugins:[{name:'slides-format-fixture',resolveId:id=>id==='/fixture.js'?id:null,load:id=>id==='/fixture.js'?fixture:null,
    configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=='/fixture') return next()
      res.setHeader('Content-Type','text/html;charset=UTF-8');res.end('<html><main style="display:flex;height:95vh"></main><script type="module" src="/fixture.js"></script></html>')})}}]})
let browser
try {
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1280,height:800}})
  page.on('pageerror',error=>console.error(error))
  await page.goto(server.resolvedUrls.local[0]+'fixture')
  const button=name=>page.getByRole('button',{name,exact:true})
  const label=name=>page.getByLabel(name,{exact:true})
  const tab=name=>page.getByRole('tab',{name,exact:true}).click()
  await label('幻灯片正文').focus()
  await label('正文字体').selectOption('Georgia')
  await label('正文字号').fill('31')
  await label('正文字号').press('Enter')
  await button('下划线').click()
  await button('右对齐').click()
  await label('正文行距').selectOption('1.5')
  await label('右栏正文').focus()
  await button('删除线').click()
  await tab('插入');await button('插入形状').click()
  await label('形状文字').fill('路径节点')
  await tab('开始');await label('对象相对幻灯片对齐').selectOption('center')
  await label('对象相对幻灯片对齐').selectOption('bottom')
  await button('复制对象').click();await button('删除对象').click()
  await tab('插入');await button('插入文本框').click()
  await label('文本框 1').fill('自由文本');await tab('开始');await button('斜体').click()
  await tab('动画');await label('动画对象').selectOption('body')
  await button('添加动画').click();await label('文字播放方式 1').selectOption('paragraph')
  const shapeOption=await label('动画对象').locator('option').filter({hasText:'路径节点'}).getAttribute('value')
  await label('动画对象').selectOption(shapeOption);await label('待添加的动画效果').selectOption('path');await button('添加动画').click()
  await tab('视图');await label('网格线').check();await page.locator('.slides-grid').waitFor()
  await label('缩略图窗格').uncheck();assert.equal(await page.locator('.slides-outline').count(),0)
  await label('备注').uncheck();assert.equal(await page.locator('.slides-notes').count(),0)
  await button('放大画布').click();assert.equal(await button('适应窗口').textContent(),'125%')
  await button('幻灯片浏览').click();await page.locator('.slides-sorter .slides-thumbnail').dblclick()
  await page.locator('.slides-canvas').waitFor()
  const base64=await page.evaluate(()=>window.saveDeck());await writeFile(file,Buffer.from(base64,'base64'))
  if(process.argv.includes('--native')){
    const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File','test/slides-ribbon-native.ps1',file],{encoding:'utf8',timeout:90000})
    assert.equal(result.status,0,result.error?.message || result.stderr || result.stdout)
    console.log(result.stdout.trim())
  }
  const slide=await page.evaluate(data=>window.loadDeck(data),(await readFile(file)).toString('base64'))
  assert.equal(slide.fieldFormats.body.fontFace,'Georgia')
  assert.equal(slide.fieldFormats.body.fontSize,process.argv.includes('--native')?32:31)
  assert.equal(slide.fieldFormats.body.underline,true);assert.equal(slide.fieldFormats.body.align,'right')
  assert.equal(slide.fieldFormats.body.lineSpacing,1.5);assert.equal(slide.fieldFormats.side.strike,true)
  if(process.argv.includes('--native')) assert.equal(slide.textBoxes[0].bold,true)
  assert.equal(slide.textBoxes[0].italic,true)
  assert.equal(slide.shapes.length,1);const shape=slide.shapes[0]
  assert.ok(Math.abs(shape.x-(1-shape.w)/2)<.0001 && Math.abs(shape.y-(1-shape.h))<.0001)
  assert.equal(slide.animations.length,2);assert.equal(slide.animations[0].byParagraph,true);assert.equal(slide.animations[1].effect,'path')
  console.log('演示功能区、视图和原生 PPTX 的字体、段落、页内对齐、段落与运动路径往返通过。',file)
} finally {await browser?.close();await server.close();await rm(join(dir,'cache'),{recursive:true,force:true,maxRetries:5,retryDelay:100})}
