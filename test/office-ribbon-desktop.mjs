import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { makePage } from '../shared/workspace.mjs'
import { writeDocx } from '../src/modules/word-docx.js'
import { newSheet } from '../src/modules/spreadsheet.js'
import { writeXlsx } from '../src/modules/spreadsheet-xlsx.js'
import { newSlide } from '../src/modules/slides-model.js'
import { exportPptx } from '../src/modules/slides-pptx.js'
import { desktopSession, eventually } from './desktop-session.mjs'

const executable = resolve(process.argv[2] || 'release/YanYe-0.9.0-windows-x64/YanYe.exe')
const output = process.argv[3] && process.argv[3] !== '--native' && resolve(process.argv[3])
const native = process.argv.includes('--native')
const folder = await mkdtemp(join(tmpdir(),'yanye-office-ribbon-'))
if (output) await mkdir(output,{recursive:true})
const para = (text, level) => ({type:level ? 'heading':'paragraph', ...(level && {attrs:{level}}),content:[{type:'text',text}]})
const word = {...makePage({kind:'word'}).content,doc:{type:'doc',content:[
  para('地方文献整理计划',1), para('本期整理地方志、乡土教材和手写笔记，先完成目录核对，再安排影像采集。'),
  para('一、编目范围',2), para('以馆藏登记号为索引，记录题名、责任者、年代与版本。对题名相近的文献，逐册核对卷次。'),
  para('二、校对与交付',2), para('编目员完成初录后，交由第二位同事核对。每周五汇总待确认的条目，附上对应的扫描页码。'),
]}}
const sheet = newSheet('编目进度')
sheet.cells = {A1:'馆藏类别',B1:'计划册数',C1:'完成册数',D1:'待整理',A2:'地方志',B2:'48',C2:'36',D2:'=B2-C2',
  A3:'乡土教材',B3:'32',C3:'21',D3:'=B3-C3',A4:'手写笔记',B4:'26',C4:'19',D4:'=B4-C4'}
sheet.styles = Object.fromEntries(['A1','B1','C1','D1'].map(ref=>[ref,{bold:true,fill:'#e6f3eb'}]))
const slides = {theme:'paper',slides:[newSlide({layout:'cover',title:'地方文献整理计划',body:'馆藏编目与数字化'}),
  newSlide({layout:'columns',title:'整理进度',body:'地方志与乡土教材',side:'手写笔记与影像资料'})]}

async function capture(page, name) {
  if (output) await page.screenshot({path:join(output,name+'.png')})
}

async function captureWordTabs(page) {
  if (!output) return
  const panels = []
  for (const name of ['开始','插入','页面','引用','审阅','视图']) {
    await page.getByRole('tab',{name,exact:true}).click()
    const ribbon = await page.locator('.office-ribbon').boundingBox()
    const toolbar = await page.locator('.ribbon-panel:visible').first().boundingBox()
    const clip = {x:ribbon.x,y:ribbon.y,width:ribbon.width,height:Math.ceil(toolbar.y+toolbar.height-ribbon.y)}
    panels.push((await page.screenshot({clip})).toString('base64'))
  }
  const png = await page.evaluate(async rows=>{
    const images = await Promise.all(rows.map(async src=>{
      const img = new Image()
      img.src='data:image/png;base64,'+src
      await img.decode()
      return img
    }))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(...images.map(img=>img.width))
    canvas.height = images.reduce((size,img)=>size+img.height,0)+8*(images.length-1)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle='#f7f6f3'
    ctx.fillRect(0,0,canvas.width,canvas.height)
    let y=0
    for (const img of images) { ctx.drawImage(img,0,y); y+=img.height+8 }
    return canvas.toDataURL('image/png').split(',')[1]
  },panels)
  await writeFile(join(output,'word-ribbons.png'),Buffer.from(png,'base64'))
}

async function withWindow(source, check) {
  const temp = await mkdtemp(join(folder,'window-'))
  const profile = join(temp,'profile')
  await mkdir(profile)
  const session = desktopSession({executable,source,temp,profile})
  try { await check(await session.start()) } finally { await session.stop() }
}

async function checkCommon(page, name) {
  const bar = page.getByRole('tablist',{name:/功能区/})
  await bar.waitFor()
  assert.equal(await page.getByRole('button',{name:'显示侧栏',exact:true}).count(),1)
  const file = page.getByRole('button',{name:'文件',exact:true})
  await file.click()
  const menu = page.locator('.office-file-menu:popover-open')
  await menu.getByRole('button',{name:/打开本地文件/}).waitFor()
  const rect = await menu.boundingBox()
  assert.ok(rect && rect.x >= 0 && rect.y >= 0 && rect.y < 160, '文件菜单应贴近顶部按钮')
  await page.keyboard.press('Escape')
  await menu.waitFor({state:'hidden'})
  await file.click()
  await menu.getByRole('button',{name:'返回文件中心'}).click()
  await page.getByRole('heading',{name:'文件中心'}).waitFor()
  await page.getByRole('navigation',{name:'打开的文件'}).locator('.disk-tab button').first().click()
  await bar.waitFor()
  await file.focus()
  await page.keyboard.press('F10')
  assert.equal(await page.locator(':focus').getAttribute('role'),'tab')
  await page.keyboard.press('ArrowRight')
  assert.equal(await bar.getByRole('tab',{selected:true}).textContent(),'插入')
  await page.keyboard.press('Escape')
  assert.ok(await file.evaluate(el=>el === document.activeElement))
  await page.keyboard.press('Control+F1')
  const tabs = name => bar.getByRole('tab',{name,exact:true})
  await page.locator('.office-page[data-ribbon-hidden=true]').waitFor()
  await tabs('开始').click()
  await page.locator('.office-page[data-ribbon-hidden=false]').waitFor()
  if (name === 'word') await page.locator('.word-sheet .word-prose p').first().click()
  await capture(page,name)
  await page.setViewportSize({width:760,height:550})
  const overflowing = await page.locator('.main-pane').evaluate(el=>el.scrollWidth > el.clientWidth + 1)
  assert.equal(overflowing,false,'最窄桌面窗口出现横向溢出')
  await page.setViewportSize({width:1280,height:768})
}

try {
  const fixtures = [['地方文献整理计划.docx','word',await writeDocx(word)],
    ['馆藏编目进度.xlsx','sheet',await writeXlsx({sheets:[sheet],active:sheet.id})],
    ['整理进度简报.pptx','slides',await exportPptx(slides,'整理进度简报')]]
  for (const [name,kind,data] of fixtures) {
    const path = join(folder,name)
    await writeFile(path,Buffer.from(data,'base64'))
    await withWindow(path,async page=>{
      await page.setViewportSize({width:1280,height:768})
      await checkCommon(page,kind)
      if (kind !== 'word') return
      await captureWordTabs(page)
      await page.locator('.word-sheet .word-prose p').first().click()
      await page.keyboard.press('Control+Alt+m')
      await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='批注内容')
      assert.ok(await page.getByRole('tab',{name:'审阅',selected:true}).isVisible())
      await page.getByRole('tab',{name:'视图',exact:true}).click()
      await page.getByRole('button',{name:'大纲',exact:true}).click()
      const outline = page.getByRole('region',{name:'文档大纲'})
      await outline.getByRole('button',{name:/编目范围/}).click()
      await outline.getByRole('button',{name:'提升一级'}).click()
      await outline.getByRole('button',{name:/1 级\s*一、编目范围/}).waitFor()
      await outline.getByRole('button',{name:'转到正文'}).click()
      await page.getByRole('button',{name:'护眼模式'}).click()
      assert.equal(await page.locator('.word-editor').getAttribute('data-eye-comfort'),'true')
      await page.getByRole('button',{name:'护眼模式'}).click()
      await page.getByRole('button',{name:'写作模式',exact:true}).click()
      await page.getByRole('button',{name:/退出写作模式/}).waitFor()
      assert.ok(await page.getByRole('tablist',{name:/功能区/}).isHidden())
      await page.keyboard.press('Escape')
      await page.getByRole('button',{name:'全屏显示'}).click()
      await page.waitForFunction(()=>Boolean(document.fullscreenElement))
      await page.getByRole('button',{name:'退出全屏'}).click()
      await page.getByRole('tab',{name:'页面',exact:true}).click()
      await page.getByLabel('本节页面边框').selectOption('double')
      await page.getByLabel('页面背景色').fill('#faf4df')
      await page.locator('.word-page-frame').waitFor()
      await capture(page,'word-page')
      await page.getByRole('button',{name:'保存文件',exact:true}).click()
      await page.getByRole('button',{name:'备份并保存原文件'}).click()
      await eventually(async()=>{
        const doc = await JSZip.loadAsync(await readFile(path))
        const xml = await doc.file('word/document.xml').async('string')
        return xml.includes('w:color="FAF4DF"') && xml.includes('<w:pgBorders') && xml.includes('w:val="double"')
      },'背景与边框未写入 DOCX')
    })
    if (kind === 'word') {
      for (const program of native ? [null,'KWPS.Application','Word.Application'] : [null]) {
        if (program) execFileSync('pwsh',['-NoProfile','-File',fileURLToPath(new URL('./office-page-native.ps1',import.meta.url)),program,path],{stdio:'inherit'})
        await withWindow(path,async page=>{
          await page.getByRole('tab',{name:'页面',exact:true}).click()
          assert.equal(await page.getByLabel('本节页面边框').inputValue(),'double')
          assert.equal(await page.getByLabel('页面背景色').inputValue(),'#faf4df')
          if (program) assert.ok((await page.locator('.word-prose').innerText()).includes(program))
        })
      }
      if (output) await writeFile(join(output,'page-appearance.docx'),await readFile(path))
    }
    console.log(name+' 桌面核对通过')
  }
} finally {
  await rm(folder,{recursive:true,force:true,maxRetries:20,retryDelay:200})
}
