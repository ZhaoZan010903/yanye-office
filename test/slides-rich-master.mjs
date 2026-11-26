import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import Zip from 'jszip'
import {createServer} from 'vite'
import {chromium} from 'playwright'

const dir=await mkdtemp(join(tmpdir(),'yanye-master-'))
const file=join(dir,'字符母版往返.pptx')
const native=process.argv.includes('--native')
const fixture=`
import React from 'react'
import {createRoot} from 'react-dom/client'
import Slides from '/src/modules/Slides.jsx'
import {newSlide,textBox} from '/src/modules/slides-model.js'
import {exportPptx,importPptx} from '/src/modules/slides-pptx.js'
import '/src/styles.css'
function Fixture(){
  const [deck,set]=React.useState(()=>({theme:'paper',slides:[
    newSlide({title:'原始标题',body:'准备\\n复核',textBoxes:[textBox({text:'前缀 Review 后缀',id:'free'})]}),
    newSlide({title:'母版继承页'})]}))
  window.deck=deck
  window.saveDeck=()=>exportPptx(deck,'字符母版往返')
  window.loadDeck=async data=>{const result=await importPptx(data);set(result);return result}
  return React.createElement(Slides,{value:deck,onChange:set})
}
createRoot(document.querySelector('main')).render(React.createElement(Fixture))`
const server=await createServer({configFile:false,cacheDir:join(dir,'cache'),logLevel:'error',
  optimizeDeps:{entries:['src/modules/Slides.jsx'],include:['react-dom/client','jszip','pptxgenjs']},server:{host:'127.0.0.1',port:0,watch:null},
  plugins:[{name:'slides-rich-master-fixture',resolveId:id=>id==='/fixture.js'?id:null,load:id=>id==='/fixture.js'?fixture:null,
    configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=='/fixture')return next()
      res.setHeader('Content-Type','text/html;charset=UTF-8');res.end('<html><main style="height:95vh;display:flex"></main><script type="module" src="/fixture.js"></script></html>')})}}]})
function openNative(phase){
  const result=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File','test/slides-rich-master-native.ps1',file,phase],{encoding:'utf8',timeout:110000})
  assert.equal(result.status,0,result.error?.message || result.stderr || result.stdout)
  console.log(result.stdout.trim())
}
let browser
try{
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1360,height:860}})
  page.on('pageerror',error=>console.error(error))
  await page.goto(server.resolvedUrls.local[0]+'fixture')
  const label=text=>page.getByLabel(text,{exact:true})
  const button=text=>page.getByRole('button',{name:text,exact:true})
  const tab=text=>page.getByRole('tab',{name:text,exact:true}).click()
  async function selectWord(from,length){
    const editor=label('文本框 1')
    await editor.focus();await editor.press('Home')
    for(let i=0;i<from;i++)await editor.press('ArrowRight')
    for(let i=0;i<length;i++)await editor.press('Shift+ArrowRight')
  }
  await selectWord(3,6)
  assert.equal(await page.evaluate(()=>getSelection().toString()),'Review')
  await label('文本框字体').selectOption('Georgia')
  await label('文本框字号').fill('30');await label('文本框字号').press('Enter')
  await label('文本框字色').fill('#aa3355')
  const runs=await page.evaluate(()=>window.deck.slides[0].textBoxes[0].runs)
  assert.deepEqual(runs,[{from:3,to:9,style:{fontFace:'Georgia',fontSize:30,color:'aa3355'}}])
  await tab('动画');await label('动画对象').selectOption('body');await button('添加动画').click();await label('文字播放方式 1').selectOption('paragraph')
  await tab('视图');await button('幻灯片母版').click()
  await label('母版背景色').fill('#f0e8d5')
  await button('添加母版文本框').click();await label('母版文本').fill('季度复核')
  await label('母版文本字体').fill('Arial');await label('母版文本颜色').fill('#557733')
  await button('关闭母版视图').click()
  assert.equal(await page.locator('.slides-thumbnail .slides-master-label').count(),2)
  const created=await page.evaluate(()=>window.saveDeck())
  const initial=await Zip.loadAsync(created,{base64:true})
  assert.match(await initial.file('ppt/slideMasters/slideMaster1.xml').async('string'),/季度复核/)
  await writeFile(file,Buffer.from(created,'base64'))
  if(native)openNative('edit')
  const revised=await readFile(file)
  const round=await page.evaluate(data=>window.loadDeck(data),revised.toString('base64'))
  const box=round.slides[0].textBoxes[0]
  assert.equal(box.text,'前缀 Review 后缀')
  const word=box.runs.find(r=>r.from<=3 && r.to>=9)
  assert.equal(word.style.fontFace,'Georgia')
  assert.equal(word.style.fontSize,native?32:30)
  assert.equal(word.style.color,native?'2255AA':'AA3355')
  assert.equal(round.masters[0].labels[0].text,native?'季度复核 WPS':'季度复核')
  assert.equal(round.masters[0].background,'F0E8D5')
  assert.ok(round.slides[0].animations.some(a=>a.byParagraph))
  await tab('开始');await selectWord(0,2);await label('文本框字体').selectOption('Arial')
  await tab('视图');await button('幻灯片母版').click();await label('母版文本颜色').fill('#883311')
  await button('关闭母版视图').click()
  const final=await page.evaluate(()=>window.saveDeck())
  const before=await Zip.loadAsync(revised),after=await Zip.loadAsync(final,{base64:true})
  for(const path of Object.keys(before.files).filter(p=>!before.files[p].dir && p!==round.masters[0].id && p!==round.slides[0].native.path)){
    assert.deepEqual(await after.file(path).async('nodebuffer'),await before.file(path).async('nodebuffer'),path)
  }
  await writeFile(file,Buffer.from(final,'base64'))
  if(native)openNative('verify')
  // Adding a slide exercises the separate generation path that transplants
  // the imported master and its layouts instead of updating a part in place.
  await tab('开始');await button('新建幻灯片').click()
  const withNewSlide=await page.evaluate(async()=>window.loadDeck(await window.saveDeck()))
  assert.equal(withNewSlide.slides.length,3)
  assert.equal(new Set(withNewSlide.slides.map(s=>s.masterId)).size,1)
  assert.equal(withNewSlide.masters[0].labels[0].color,'883311')
  assert.equal(withNewSlide.masters[0].background,'F0E8D5')
  console.log('同框字符选区、母版两页继承、段落动画、原生部件保留通过。',file)
} finally{await browser?.close();await server.close();await rm(join(dir,'cache'),{recursive:true,force:true,maxRetries:4,retryDelay:120})}
