import assert from 'node:assert/strict'
import {copyFile,mkdtemp,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {desktopSession} from './desktop-session.mjs'
const temp=await mkdtemp(join(tmpdir(),'yanye-release-grid-'))
const source=join(temp,'验收副本.xlsx'),profile=join(temp,'profile')
await mkdir(profile);await copyFile(resolve(process.argv[3]),source)
const session=desktopSession({executable:resolve(process.argv[2]),source,profile,temp})
try{
 const p=await session.start();p.setDefaultTimeout(90000)
 const grid=p.getByLabel('工作表网格',{exact:true}), name=p.getByLabel('名称框')
 await grid.locator('[data-address="A1"]').waitFor()
 const samples=await grid.evaluate(async el=>{
   const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve))
   const test=async (dx,dy)=>{
     el.scrollTop=0;el.scrollLeft=0;await frame();await frame()
     let before=await frame();const times=[]
     for(let i=1;i<=54;i++){
       el.scrollTop=dy*i;el.scrollLeft=dx*i
       const after=await frame();if(i>4)times.push(after-before);before=after
     }
     await frame()
     times.sort((a,b)=>a-b)
     return {n:times.length,median:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],domCells:el.querySelectorAll('[data-address]').length}
   }
   return {normal:await test(8,32),jump:await test(1251,23257)}
 })
 console.log('frames '+JSON.stringify(samples))
 await name.fill('BTT100000');await name.press('Enter')
 const cell=grid.locator('[data-address="BTT100000"]')
 await cell.waitFor()
 assert.equal(await cell.innerText(),'砚页回存')
 await grid.press('F2');const field=p.getByLabel('编辑 BTT100000',{exact:true})
 await field.fill('发布测试')
 const result=await field.evaluate(async input=>{
   const t=performance.now(),end=new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()))))
   input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}))
   return (await end)-t
 })
 await name.fill('BTT100000');await name.press('Enter')
 assert.equal(await cell.innerText(),'发布测试')
 await p.evaluate(()=>window.yanye.save())
 console.log('Commit and two animation frames (ms) '+result.toFixed(1))
 console.log('Office cell edit and local draft flush passed')
} finally {await session.stop()}