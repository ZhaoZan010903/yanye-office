import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import { SaxesParser } from 'saxes'
import { desktopSession, eventually } from './desktop-session.mjs'
import { writeDocx } from '../src/modules/word-docx.js'
import { newSheet } from '../src/modules/spreadsheet.js'
import { createPivot } from '../src/modules/sheet-pivot.js'
import { readXlsx, writeXlsx } from '../src/modules/spreadsheet-xlsx.js'
import { newSlide } from '../src/modules/slides-model.js'
import { exportPptx } from '../src/modules/slides-pptx.js'

const executable=resolve(process.argv[2] || 'release/YanYe-0.8.0-windows-x64/YanYe.exe')
const root=await mkdtemp(join(tmpdir(),'yanye-office08-desktop-'))

async function withDesktop(name,base64,check) {
  const folder=join(root,name.split('.')[0]), profile=join(folder,'profile')
  await mkdir(profile,{recursive:true})
  const source=join(folder,name)
  await writeFile(source,Buffer.from(base64,'base64'))
  const session=desktopSession({executable,source,profile,temp:folder})
  try {await check(await session.start(),source)} finally {await session.stop()}
}

async function save(page, file, check) {
  await page.getByRole('button',{name:'保存文件',exact:true}).click()
  const confirm=page.getByRole('button',{name:'备份并保存原文件'})
  await Promise.race([confirm.waitFor(),page.getByText('文件已保存到磁盘',{exact:true}).waitFor()])
  if (await confirm.isVisible()) await confirm.click()
  await eventually(async()=>check(await readFile(file)),'写回文件未达到预期。')
}

async function paragraphs(bytes) {
  const zip=await JSZip.loadAsync(bytes)
  const xml=await zip.file('word/document.xml').async('string')
  const parser=new SaxesParser({xmlns:true}), rows=[]
  let inText=false
  parser.on('opentag',el=>{
    if (el.local==='p') rows.push('')
    if (el.local==='t') inText=true
  })
  parser.on('text',part=>{if(inText) rows[rows.length-1]+=part})
  parser.on('closetag',el=>{if(el.local==='t') inText=false})
  parser.write(xml).close()
  return {rows,trackedBreak:/<w:rPr>\s*<w:del\b/u.test(xml)}
}

async function word() {
  const originals=['预算初稿','工程支出','校对意见']
  const doc={type:'doc',content:originals.map(text=>({type:'paragraph',content:[{type:'text',text}]}))}
  await withDesktop('跨段修订.docx',await writeDocx({doc}),async(page,file)=>{
    const body=page.getByRole('textbox',{name:'Word 文档正文'})
    await body.locator('p').first().click()
    await page.keyboard.press('Control+Shift+e')
    await page.getByRole('tab',{name:'审阅'}).click()
    assert.ok(await page.getByLabel('记录文字修订').isChecked())
    await body.click()
    await body.evaluate(el=>{
      const rows=el.querySelectorAll('p')
      const range=document.createRange()
      range.setStart(rows[0].firstChild,2)
      range.setEnd(rows[2].firstChild,2)
      const selection=getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    })
    await page.keyboard.press('Backspace')
    await page.getByRole('button',{name:'拒绝全部修订'}).waitFor()
    await save(page,file,async bytes=>(await paragraphs(bytes)).trackedBreak)
    await page.getByRole('button',{name:'拒绝全部修订'}).click()
    assert.deepEqual(await body.locator('p').allTextContents(),originals)
    await save(page,file,async bytes=>{
      const {rows,trackedBreak}=await paragraphs(bytes)
      return !trackedBreak && JSON.stringify(rows)===JSON.stringify(originals)
    })
  })
}

async function sheets() {
  const source=newSheet('销售明细')
  source.cells={A1:'地区',B1:'城市',C1:'季度',D1:'金额',A2:'东',B2:'沪',C2:'冬',D2:'20',
    A3:'东',B3:'杭',C3:'春',D3:'25',A4:'西',B4:'渝',C4:'春',D4:'10'}
  const config={ref:'A1:D4',rowFields:[0,1],columnField:2,dataField:3,summary:'sum'}
  const first=createPivot({active:source.id,sheets:[source]},source,config)
  const book=createPivot(first,source,{...config,rowFields:[1]})
  const totalCell=sheet=>sheet.pivot.reportRange.split(':').at(-1)
  await withDesktop('经营分析.xlsx',await writeXlsx(book),async(page,file)=>{
    const tabs=page.locator('.sheet-tabs')
    await tabs.getByRole('button',{name:'销售明细',exact:true}).click()
    await page.locator('td[data-address="D2"]').click()
    await page.getByRole('textbox',{name:'公式栏'}).fill('32')
    async function report(index,total) {
      const sheet=book.sheets[index]
      await tabs.getByRole('button',{name:sheet.name,exact:true}).click()
      const cell=page.locator('td[data-address="'+totalCell(sheet)+'"]')
      await cell.waitFor()
      assert.equal(await cell.innerText(),String(total))
      return cell
    }
    const grid=page.getByRole('region',{name:'工作表网格'})
    const current=await report(1,55)
    await grid.press('Alt+F5')
    assert.equal(await current.innerText(),'67')
    const other=await report(2,55)
    await grid.press('Control+Alt+F5')
    assert.equal(await other.innerText(),'67')
    await save(page,file,async bytes=>{
      const reopened=await readXlsx(bytes.toString('base64'))
      return reopened.filter(s=>s.pivot).length===2 && reopened.filter(s=>s.pivot).every(s=>s.cells[totalCell(s)]==='67')
    })
  })
}

async function slides() {
  const path='M 0 0 C 0.08 -0.32 0.32 -0.32 0.4 0 L 0.47 0.06 E'
  const slide=newSlide({title:'流转',body:'起草\n复核\n归档',animations:[
    {id:'steps',target:'body',effect:'fade',trigger:'click',duration:250,delay:0,byParagraph:true},
    {id:'travel',target:'title',effect:'path',trigger:'click',duration:1200,delay:0,path},
  ]})
  // Optionally take the final same-path native sample produced by the slide test.
  const base64=process.argv[3] ? (await readFile(process.argv[3])).toString('base64') :
    await exportPptx({slides:[slide]},'段落路径校样')
  await withDesktop('段落路径校样.pptx',base64,async(page,file)=>{
    await page.getByRole('tab',{name:'动画',exact:true}).click()
    await page.keyboard.press('F5')
    const screen=page.locator('.slides-projector')
    const blocks=screen.locator('[data-animation-paragraph]')
    await blocks.nth(2).waitFor({state:'attached'})
    for (let count=0;count<=3;count++) {
      if (count) await page.keyboard.press('ArrowRight')
      await eventually(async()=>await blocks.evaluateAll((nodes,n)=>nodes.length===3 &&
        nodes.every((el,i)=>(getComputedStyle(el).visibility==='visible')===(i<n)),count),
      '放映没有逐次显示预期段落。')
    }
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(()=>document.querySelector('.slides-projector')?.getAnimations({subtree:true}).some(
      a=>a.effect.getKeyframes?.().some(frame=>frame.translate!=null)))
    const positions=await screen.evaluate(el=>{
      const moving=[...el.querySelectorAll('[data-animation-target]')].find(target=>target.getAnimations().some(
        anim=>anim.effect.getKeyframes().some(frame=>frame.translate!=null)))
      if (!moving) throw Error('没有检测到运动路径动画。')
      const anim=moving.getAnimations().find(a=>a.effect.getKeyframes().some(frame=>frame.translate!=null))
      anim.pause()
      const slide=el.querySelector('.slides-page')
      const sample=fraction=>{
        anim.currentTime=anim.effect.getTiming().duration*fraction
        const box=slide.getBoundingClientRect()
        const [x,y]=getComputedStyle(moving).translate.split(' ').map(parseFloat)
        return [x/box.width,(y||0)/box.height]
      }
      const points=[0,.45,1].map(sample)
      // A fullscreen transition can resize the slide after the first click.
      el.style.width=(el.getBoundingClientRect().width*.75)+'px'
      points.push(sample(1))
      el.style.removeProperty('width')
      return points
    })
    assert.ok(positions[1][1]<-.1,'路径中段应高于起点。')
    for (const [x,y] of positions.slice(2)) assert.ok(Math.abs(x-.47)<.01 && Math.abs(y-.06)<.01,JSON.stringify(positions))
    assert.equal((await readFile(file)).toString('base64'),base64)
    console.log('放映起点、中段、终点、调整尺寸后的终点（相对页宽、页高）',positions)
  })
}

try {
  await word()
  await sheets()
  await slides()
  console.log('Windows 发行版已验证跨段删除与拒绝、两份透视报告的单独和全部刷新、原路径保存、逐段单击与曲线放映。')
} finally {await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:250})}
