import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { readXlsx } from '../src/modules/spreadsheet-xlsx.js'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const temp = await mkdtemp(join(tmpdir(),'yanye-grid-test-'))
const exe = process.argv[2] ? resolve(process.argv[2]) : createRequire(import.meta.url)('electron')
const output = join(temp,'预算.xlsx')
let app
async function start() {
  app = await _electron.launch({ executablePath:exe, args:process.argv[2] ? [] : [root], env:{...process.env,YANYE_PROFILE:join(temp,'profile')} })
  const page = await app.firstWindow()
  page.setDefaultTimeout(8000)
  await page.getByRole('textbox',{name:'页面标题'}).waitFor()
  return page
}
async function close() {
  const ended = app.waitForEvent('close',{timeout:8000})
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close()).catch(()=>{})
  await ended
  app = undefined
}
try {
  let page = await start()
  await page.getByRole('button',{name:'新建页面',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'电子表格',exact:true}).click()
  const cell = ref=>page.locator('td[data-address="'+ref+'"]')
  async function fill(ref, text) {
    await cell(ref).dblclick()
    const input = page.getByRole('textbox',{name:'编辑 '+ref,exact:true})
    await input.fill(text)
    await input.press('Enter')
  }
  await fill('A1','支出'); await fill('B1','金额')
  await fill('A2','宣传'); await fill('B2','12'); await fill('A3','材料'); await fill('B3','30')
  await fill('B4','=SUM(B2:B3)')
  assert.equal(await cell('B4').innerText(),'42')
  await cell('B3').click()
  await page.getByText('排序与筛选',{exact:true}).click()
  await page.getByRole('button',{name:'按 B 列降序'}).click()
  const order = await page.locator('tbody tr th').allTextContents()
  assert.deepEqual(order.slice(0,4),['1','4','3','2'])
  await page.getByRole('button',{name:'柱状图',exact:true}).click()
  await page.getByRole('region',{name:'柱状图'}).waitFor()
  await page.getByRole('button',{name:'新建工作表'}).click()
  await fill('A1','=工作表1!B4*2')
  assert.equal(await cell('A1').innerText(),'84')
  await app.evaluate(({dialog},file)=>{
    dialog.showSaveDialog = async()=>({canceled:false,filePath:file})
    dialog.showOpenDialog = async()=>({canceled:false,filePaths:[file]})
  },output)
  await page.locator('.sheet-menu summary').filter({hasText:'导出'}).click()
  await page.getByRole('button',{name:'导出 XLSX'}).click()
  await page.getByText('已导出 XLSX。',{exact:false}).waitFor()
  const exported = await readXlsx((await readFile(output)).toString('base64'))
  assert.equal(exported.length,2)
  assert.equal(exported[1].cells.A1,'=工作表1!B4*2')
  await page.locator('.sheet-menu summary').filter({hasText:'导入'}).click()
  await page.getByRole('button',{name:'导入 XLSX'}).click()
  await page.getByText('已添加 2 张工作表。',{exact:false}).waitFor()
  await page.getByRole('button',{name:'工作表2 (2)',exact:true}).click()
  assert.equal(await cell('A1').innerText(),'84')
  await close()
  page = await start()
  assert.equal(await cell('A1').innerText(),'84')
  await close()
  console.log('Windows 网格编辑、排序、柱状图、跨表求和、XLSX 实际导入导出及重启持久化通过。')
} finally {
  if (app) await app.close().catch(()=>{})
  await rm(temp,{recursive:true,force:true,maxRetries:5})
}
