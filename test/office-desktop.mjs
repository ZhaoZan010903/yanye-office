import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import JSZip from 'jszip'

const button = (scope, name) => scope.getByRole('button', { name, exact: true })
const field = (scope, name) => scope.getByLabel(name, { exact: true })
const cell = (page, name) => page.locator('td[data-address="' + name + '"]')

async function capture(page, name) {
  const directory = process.env.YANYE_OFFICE_CAPTURE
  if (!directory) return
  await mkdir(directory, { recursive: true })
  await page.screenshot({ path: join(directory, name + '.png'), scale: 'css' })
}

async function createPage(page, kind, title) {
  await button(page, '新建页面').click()
  await button(page.getByRole('dialog'), kind).click()
  await field(page, '页面标题').fill(title)
}

async function selectFile(app, file) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, file)
}

async function exported(file) {
  const deadline = Date.now() + 15000
  for (;;) {
    try { return await readFile(file) } catch (error) {
      if (error.code !== 'ENOENT' || Date.now() >= deadline) throw error
      await delay(100)
    }
  }
}

export async function exerciseOffice(page, app, temp) {
  await createPage(page, '电子表格', '月度预算')
  for (const [address, value] of [['A1','2'], ['A2','3'], ['B1','=SUM(A1:A2)'], ['A2','4']]) {
    await cell(page, address).click()
    await field(page, '公式栏').fill(value)
  }
  assert.equal(await cell(page, 'B1').innerText(), '6')
  await capture(page, 'spreadsheet')

  await createPage(page, '多维表格', '行动项')
  await button(page, '新增记录').click()
  const record = page.getByRole('dialog', { name: '记录详情' })
  await field(record, '名称').fill('核对预算')
  await field(record, '状态').selectOption('进行中')
  const month = await page.evaluate(() => {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01'
  })
  await field(record, '日期').fill(month)
  await button(record, '完成').click()
  await button(page, '看板').click()
  const group = page.locator('.base-board section').filter({ has: page.getByText('进行中', {exact:true}) })
  await button(group, '核对预算').click()
  await field(record, '名称').fill('复核采购预算')
  await button(record, '完成').click()
  await button(page, '日历').click()
  await button(page, '复核采购预算').waitFor()
  await capture(page, 'database')
  await button(page, '表格').click()
  assert.equal(await field(page, '1 行 名称').inputValue(), '复核采购预算')
  const backup = join(temp, 'records.json')
  await selectFile(app, backup)
  await button(page, '导入导出').click()
  await button(page.getByRole('dialog'), '导出 JSON').click()
  const base = JSON.parse(await exported(backup))
  assert.equal(base.records[0].cells.status, '进行中')
  await field(page, '1 行 名称').fill('临时修改')
  await button(page, '导入导出').click()
  await button(page.getByRole('dialog'), '导入 JSON').click()
  await button(page.getByRole('dialog'), '确认导入').click()
  assert.equal(await field(page, '1 行 名称').inputValue(), '复核采购预算')

  await createPage(page, '流程图与白板', '报销流程')
  await button(page, '添加第一个步骤').click()
  await field(page, '对象文字').fill('财务核准')
  await button(page, '模板').click()
  await button(page, '审批流程').click()
  const drawing = page.getByRole('group', { name: '绘图画布' })
  assert.ok(await drawing.locator('[data-node]').count() > 3)
  await button(page, '适应全部图形').click()
  await capture(page, 'canvas')
  const mmd = join(temp, 'flow.mmd')
  await selectFile(app, mmd)
  await button(page, '文件').click()
  await button(page, '导出 Mermaid 流程图').click()
  assert.match((await exported(mmd)).toString(), /flowchart[\s\S]*财务核准/u)

  await createPage(page, '演示文稿', '月度评审')
  await field(page, '幻灯片标题').fill('本月议程')
  await field(page, '演讲者备注').fill('提醒核对数字')
  await button(page, '新建幻灯片').click()
  await field(page, '幻灯片标题').fill('预算决议')
  await field(page, '幻灯片正文').fill('七月开始执行')
  await capture(page, 'presentation')
  const pptx = join(temp, 'review.pptx')
  await selectFile(app, pptx)
  await button(page, '导出 PPTX').click()
  const zip = await JSZip.loadAsync(await exported(pptx))
  assert.match(await zip.file('ppt/slides/slide2.xml').async('string'), /<a:t>预算决议<\/a:t>/u)
  assert.match(await zip.file('ppt/notesSlides/notesSlide1.xml').async('string'), /提醒核对数字/u)
  const pdf = join(temp, 'review.pdf')
  await selectFile(app, pdf)
  await button(page, '导出 PDF').click()
  const printed = (await exported(pdf)).toString('latin1')
  assert.ok(printed.startsWith('%PDF-'))
  assert.equal((printed.match(/\/Type\s*\/Page\b/g) || []).length, 2)
  await button(page, '放映').click()
  await button(page, '上一页').click()
  await page.locator('.slides-projector').getByText('本月议程', { exact:true }).waitFor()
  await page.keyboard.press('Escape')
  await field(page, '幻灯片标题').waitFor()
}

export async function verifyOfficeRestart(page) {
  assert.equal(await field(page, '页面标题').inputValue(), '月度评审')
  await button(page, '第 1 页 本月议程').click()
  assert.equal(await field(page, '演讲者备注').inputValue(), '提醒核对数字')
  await button(page, '第 2 页 预算决议').click()
  assert.equal(await field(page, '幻灯片正文').inputValue(), '七月开始执行')
  await button(page, '报销流程').click()
  await page.locator('[data-node][aria-label="财务核准"]').waitFor()
  assert.ok(await page.locator('[data-canvas-scene] line[marker-end]').count() > 0)
  await button(page, '行动项').click()
  assert.equal(await field(page, '1 行 名称').inputValue(), '复核采购预算')
  assert.equal(await field(page, '1 行 状态').inputValue(), '进行中')
  await button(page, '月度预算').click()
  assert.equal(await cell(page, 'B1').innerText(), '6')
}
