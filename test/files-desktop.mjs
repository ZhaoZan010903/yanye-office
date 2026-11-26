import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron } from 'playwright'
import ExcelJS from 'exceljs'
import pptxgen from 'pptxgenjs'
import JSZip from 'jszip'

const root = resolve(fileURLToPath(new URL('../',import.meta.url)))
const appDir = await mkdtemp(join(tmpdir(),'yanye-files-desktop-'))
const folder = join(appDir,'项目资料')
await mkdir(folder)
const profile = join(appDir,'profile')
const xlsx = join(folder,'来源工作簿.xlsx'), pptx = join(folder,'来源演示.pptx')
const fixtures = process.env.YANYE_OFFICE_FIXTURES
if (fixtures) {
  await copyFile(join(fixtures,'source.xlsx'),xlsx)
  await copyFile(join(fixtures,'source.pptx'),pptx)
} else {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('预算')
  sheet.getCell('A1').value = 3
  sheet.getCell('B1').value = {formula:'A1*2',result:6}
  await book.xlsx.writeFile(xlsx)
  const deck = new pptxgen()
  deck.layout = 'LAYOUT_WIDE'
  deck.addSlide().addText('原始汇报',{x:1,y:1,w:6,h:1})
  await deck.writeFile({fileName:pptx})
}
const oldBytes = await readFile(xlsx)
const errors = []
let app, page
const b = (name, scope=page) => scope.getByRole('button',{name,exact:true})
const label = name => page.getByLabel(name,{exact:true})
const dialog = name => page.getByRole('dialog',{name,exact:true})
async function launch() {
  app = await _electron.launch({executablePath:process.argv[2] ? resolve(process.argv[2]) : createRequire(import.meta.url)('electron'),
    args:process.argv[2] ? [] : [root], env:{...process.env,YANYE_PROFILE:profile}})
  page = await app.firstWindow()
  await page.context().setOffline(true)
  page.setDefaultTimeout(9000)
  page.on('pageerror',e=>errors.push(e.message))
}
async function close() {
  const ended = app.waitForEvent('close',{timeout:12000})
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close()).catch(()=>{})
  await ended
  app = null
}
async function setDialogFile(name) {
  await app.evaluate(({dialog},path) => {
    dialog.showOpenDialog = async () => ({canceled:false,filePaths:[path]})
    dialog.showSaveDialog = async () => ({canceled:false,filePath:path})
  },name)
}
async function until(check) {
  const deadline = Date.now()+15000
  while (true) {
    try { if (await check()) return } catch (error) { if (Date.now()>deadline) throw error }
    if (Date.now()>deadline) throw new Error('文件操作等待超时')
    await delay(75)
  }
}
async function folderHome() {
  await b('文件中心').click()
  await b('本地文件夹').click()
}
async function saveImported() {
  await b('保存文件').click()
  await b('备份并保存原文件',dialog('保存到原 Office 文件')).click()
  await page.getByText('文件已保存到磁盘',{exact:true}).waitFor()
}
try {
  await launch()
  await page.getByRole('heading',{name:'文件中心'}).waitFor()
  await b('本地文件夹').click()
  await setDialogFile(folder)
  await b('选择目录').click()
  await b('新建文件夹').click()
  await label('文件夹名称').fill('项目')
  await b('创建',dialog('新建文件夹')).click()
  await b('项目').waitFor()
  await b('新建Word 文档').click()
  await label('文件名称').fill('会议说明')
  await b('创建',dialog('新建Word 文档')).click()
  await label('Word 文档正文').fill('本周会议议题')
  await page.keyboard.press('Control+s')
  await page.getByText('文件已保存到磁盘',{exact:true}).waitFor()
  let doc = await JSZip.loadAsync(await readFile(join(folder,'会议说明.docx')))
  assert.match(await doc.file('word/document.xml').async('string'),/本周会议议题/)
  await folderHome()
  await b('会议说明.docx 的文件操作').click()
  await b('重命名',dialog('会议说明.docx')).click()
  await label('文件名称').fill('会议纪要.docx')
  await b('保存名称',dialog('重命名')).click()
  await b('会议纪要.docx 的文件操作').click()
  await b('移动到文件夹',dialog('会议纪要.docx')).click()
  await b('项目',dialog('移动到文件夹')).click()
  await b('移到这里').click()
  await until(async()=>Boolean(await stat(join(folder,'项目','会议纪要.docx'))))
  await b('来源工作簿.xlsx',page.locator('.files-table')).click()
  await page.locator('td[data-address="A1"]').click()
  await label('公式栏').fill('12')
  assert.equal(await page.locator('td[data-address="B1"]').innerText(),'24')
  await page.locator('td[data-address="B1"]').click()
  if (fixtures) {
    assert.equal(await label('选区垂直对齐').inputValue(),'top')
    assert.equal(await b('选区下划线').getAttribute('aria-pressed'),'true')
  }
  await label('选区数字格式').selectOption('scientific')
  await label('选区垂直对齐').selectOption('middle')
  await label('选区字体',{exact:true}).selectOption('Cambria')
  await b('选区删除线').click()
  await page.locator('.sheet-menu summary').filter({hasText:'边框'}).click()
  await b('全部框线').click()
  assert.equal(await page.locator('td[data-address="B1"]').innerText(),'2.40E+01')
  await saveImported()
  const diskBook = new ExcelJS.Workbook()
  await diskBook.xlsx.readFile(xlsx)
  assert.equal(diskBook.worksheets[0].getCell('A1').value,12)
  assert.equal(diskBook.worksheets[0].getCell('B1').formula,'A1*2')
  if (fixtures) await copyFile(xlsx,join(fixtures,'revised.xlsx'))
  await folderHome()
  await b('来源演示.pptx',page.locator('.files-table')).click()
  assert.equal(await label('幻灯片标题').inputValue(),'原始汇报')
  await label('幻灯片标题').fill('评审通过')
  await saveImported()
  if (fixtures) await copyFile(pptx,join(fixtures,'revised.pptx'))
  const slideArchive = await JSZip.loadAsync(await readFile(pptx))
  assert.match(await slideArchive.file('ppt/slides/slide1.xml').async('string'),/评审通过/)
  const sheetTab = page.getByRole('navigation',{name:'打开的文件'})
  await b('来源工作簿.xlsx',sheetTab).click()
  await page.locator('td[data-address="A1"]').click()
  await label('公式栏').fill('20')
  await writeFile(xlsx,oldBytes)
  await b('保存文件').click()
  await page.getByRole('alert').filter({hasText:'其他程序修改'}).first().waitFor()
  assert.deepEqual(await readFile(xlsx),oldBytes)
  const copy = join(folder,'独立预算.xlsx')
  await setDialogFile(copy)
  await page.keyboard.press('Control+Shift+s')
  await until(async()=>Boolean(await stat(copy)))
  await page.getByText('文件已保存到磁盘',{exact:true}).waitFor()
  await b('文件中心').click()
  await b('最近文件').click()
  await b('独立预算.xlsx',page.locator('.files-table')).waitFor()
  if (process.env.YANYE_FILE_CAPTURE) {
    await b('本地文件夹').click()
    await b('来源工作簿.xlsx',page.locator('.files-table')).waitFor()
    await page.locator('.notice').waitFor({state:'hidden'})
    await page.screenshot({path:process.env.YANYE_FILE_CAPTURE,scale:'css'})
    await b('最近文件').click()
  }
  await close()
  await launch()
  await page.getByRole('heading',{name:'文件中心'}).waitFor()
  await b('独立预算.xlsx',page.locator('.files-table')).click()
  assert.equal(await page.locator('td[data-address="B1"]').innerText(),'4.00E+01')
  assert.deepEqual(errors,[])
  await close()
  console.log('文件中心实测通过。磁盘新建、重命名、移动、Office 文件读写、最近文件、多标签、外部冲突、另存及重启。')
} finally {
  if (app) await app.close().catch(()=>{})
  await rm(appDir,{recursive:true,force:true,maxRetries:4})
}
