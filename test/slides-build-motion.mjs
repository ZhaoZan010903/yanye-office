import assert from 'node:assert/strict'
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {basename,join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'vite'
import {chromium} from 'playwright'

const file=resolve(process.argv[2])
assert.equal(basename(file),'段落路径校样.pptx','只能写入本测试的独立校样')
const verify=process.argv.includes('--verify')
const cache=await mkdtemp(join(tmpdir(),'yanye-animation-browser-'))
const harness=`
import React from 'react'
import {createRoot} from 'react-dom/client'
import Slides from '/src/modules/Slides.jsx'
import {exportPptx,importPptx} from '/src/modules/slides-pptx.js'
import '/src/styles.css'
const root=createRoot(document.querySelector('main'))
function Fixture({deck}) {
  const [value,setValue]=React.useState(deck)
  window.deck=value
  return React.createElement(Slides,{value,onChange:next=>{setValue(next);return true}})
}
window.openDeck=async data=>root.render(React.createElement(Fixture,{deck:await importPptx(data)}))
window.saveDeck=()=>exportPptx(window.deck,'段落路径校样')
`
const server=await createServer({configFile:false,cacheDir:cache,logLevel:'error',
  server:{host:'127.0.0.1',port:0,watch:null},optimizeDeps:{include:['react-dom/client','jszip','pptxgenjs']},
  plugins:[{name:'motion-fixture',resolveId:id=>id==='/motion-fixture.js'?id:null,
    load:id=>id==='/motion-fixture.js'?harness:null,configureServer(s){s.middlewares.use((req,res,next)=>{
      if(req.url!=='/motion-fixture')return next()
      res.setHeader('Content-Type','text/html;charset=UTF-8')
      res.end('<!doctype html><main></main><script type="module" src="/motion-fixture.js"></script>')
    })}}]})
let browser
try {
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1400,height:900},reducedMotion:'no-preference'})
  page.on('pageerror',e=>console.error(e.message))
  await page.goto(server.resolvedUrls.local[0]+'motion-fixture')
  await page.waitForFunction(()=>window.openDeck)
  await page.evaluate(data=>window.openDeck(data),(await readFile(file)).toString('base64'))
  await page.getByRole('tab',{name:'动画',exact:true}).click()
  const slide=await page.evaluate(()=>window.deck.slides[0])
  assert.equal(slide.nativeTiming.editable,true,JSON.stringify(slide.animations))
  assert.equal(slide.animations.length,2)
  assert.equal(slide.animations[0].byParagraph,true)
  assert.equal(slide.animations[1].effect,'path')
  const build=page.getByLabel('文字播放方式 1')
  const guide=page.getByLabel('路径指令')
  const motion='M 0 0 C 0.08 -0.32 0.32 -0.32 0.4 0 L 0.46 0.06 E'
  if (!verify) {
    await build.selectOption('object'); await build.selectOption('paragraph')
    await guide.fill('M 0 0 C bad');await page.getByRole('button',{name:'应用路径'}).click()
    await page.getByRole('alert').filter({hasText:'路径须从'}).waitFor()
    await guide.fill(motion);await page.getByRole('button',{name:'应用路径'}).click()
    const handle=page.getByRole('button',{name:'路径节点 4'})
    await handle.focus();await handle.press('ArrowRight')
    await page.waitForFunction(()=>document.querySelector('.slide-path-editor label input')?.value.endsWith('L 0.47 0.06 E'))
    const path=await guide.inputValue()
    assert.match(path,/L 0\.47 0\.06 E$/)
    // Also construct a curve and a paragraph build on previously unanimated objects.
    const add=page.getByRole('button',{name:'添加动画',exact:true})
    await add.click()
    await page.getByLabel('文字播放方式 3').selectOption('paragraph')
    await page.getByLabel('动画效果 3').selectOption('path')
    await page.getByRole('button',{name:'添加曲线段'}).last().click()
    assert.equal(await page.evaluate(()=>window.deck.slides[0].animations[2].path.match(/C/g).length),2)
    await page.getByRole('button',{name:'移除动画'}).last().click()
    const data=await page.evaluate(()=>window.saveDeck())
    await writeFile(file,Buffer.from(data,'base64'))
  }
  const animation=await page.evaluate(()=>window.deck.slides[0].animations)
  if (verify) {assert.equal(animation[1].duration,1500);assert.equal(animation[1].delay,125)}
  await page.keyboard.press('F5')
  const projector=page.locator('.slides-projector')
  const blocks=projector.locator('[data-animation-paragraph]')
  const visibility=()=>blocks.evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).visibility))
  await blocks.nth(2).waitFor({state:'attached'})
  assert.deepEqual(await visibility(),['hidden','hidden','hidden'])
  for(let i=0;i<3;i++) {
    await page.keyboard.press('ArrowRight')
    assert.deepEqual(await visibility(),Array.from({length:3},(_,j)=>j<=i?'visible':'hidden'))
  }
  const moving=projector.locator('[data-animation-target="'+animation[1].target+'"]')
  const size=await projector.locator('.slides-page').boundingBox()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(target=>document.querySelector('.slides-projector [data-animation-target="'+target+'"]').getAnimations().length>0,animation[1].target)
  const samples=await moving.evaluate(el=>{
    const a=el.getAnimations()[0]
    a.pause()
    return [0,.45,1].map(fraction=>{
      a.currentTime=a.effect.getTiming().duration*fraction
      return getComputedStyle(el).translate.split(' ').map(parseFloat)
    })
  })
  assert.ok(samples[1][1]<-size.height*.1,'曲线路径中段应高于起点')
  assert.ok(Math.abs(samples[2][0]/size.width-.47)<.01,JSON.stringify({samples,size}))
  assert.ok(Math.abs(samples[2][1]/size.height-.06)<.01)
  console.log(JSON.stringify({file,mode:verify?'再次读取':'砚页修改保存',paragraphClicks:3,path:animation[1].path,sampledPosition:samples}))
} finally {await browser?.close();await server.close();await rm(cache,{recursive:true,force:true,maxRetries:5,retryDelay:200})}
