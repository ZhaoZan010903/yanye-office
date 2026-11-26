import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { exerciseOffice, verifyOfficeRestart } from './office-desktop.mjs'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const exe = process.argv[2] ? resolve(process.argv[2]) : createRequire(import.meta.url)('electron')
const args = process.argv[2] ? [] : [root]
const temp = await mkdtemp(join(tmpdir(), 'yanye-desktop-'))
const profile = join(temp, 'profile')
const appErrors = []
let application

async function start(firstLaunch = false) {
  application = await _electron.launch({ executablePath: exe, args, env: { ...process.env, YANYE_PROFILE: profile }, timeout: 22_000 })
  const page = await application.firstWindow({ timeout: 12_000 })
  await page.context().setOffline(true)
  page.setDefaultTimeout(7_000)
  page.on('pageerror', error => appErrors.push(error.message))
  if (firstLaunch) await page.getByRole('button',{name:'写作工作台',exact:true}).click()
  await page.getByRole('textbox', { name: '页面标题' }).waitFor()
  return page
}

async function close() {
  const closed = application.waitForEvent('close', { timeout: 9_000 })
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {})
  await closed
  application = undefined
}

try {
  let page = await start(true)
  const title = () => page.getByRole('textbox', { name: '页面标题' })
  const body = () => page.getByRole('textbox', { name: '正文编辑器' })
  const source = () => page.getByRole('textbox', { name: 'Markdown 源码' })
  const button = name => page.getByRole('button', { name, exact: true })
  const dialog = () => page.getByRole('dialog')

  assert.equal(await title().inputValue(), '写作工作台')
  await page.getByRole('heading', { name: '今日清单' }).waitFor()
  assert.equal(await body().getByRole('checkbox').count(), 3)

  if (process.env.YANYE_CAPTURE) {
    const image = resolve(process.env.YANYE_CAPTURE)
    await mkdir(dirname(image), { recursive: true })
    await page.screenshot({ path: image, scale: 'css' })
  }

  await body().getByRole('checkbox').nth(1).check()
  await page.getByRole('progressbar', { name: '已完成 2 项，共 3 项' }).waitFor()
  await button('源码').click()
  assert.match(await source().inputValue(), /- \[x\] 整理收件箱/u)
  await button('富文本').click()

  await page.keyboard.press('Control+k')
  const search = page.getByRole('textbox', { name: '搜索标题或正文' })
  await search.fill('反向提纲')
  await search.press('Enter')
  assert.equal(await title().inputValue(), '灵感收件箱')
  await button('写作工作台').click()

  await button('新建子页面').click()
  await title().fill('验证子页')
  await body().pressSequentially('/todo')
  await page.locator('.slash-menu').getByRole('button', { name: /待办清单/u }).waitFor()
  await page.keyboard.press('Enter')
  await body().pressSequentially('Save this')
  assert.equal(await body().getByRole('checkbox').count(), 1)
  await button('源码').click()
  assert.match(await source().inputValue(), /- \[ \] Save this/u)

  const document = '## 草稿\n\n**第一段**\n\n| 列 | 值 |\n| --- | --- |\n| 甲 | 乙 |\n'
  await source().fill(document)
  await button('富文本').click()
  await body().getByRole('heading', { name: '草稿' }).waitFor()
  assert.equal(await body().getByRole('table').count(), 1)

  await button('页面操作').click()
  await dialog().getByRole('button', { name: '移动到', exact: true }).click()
  await dialog().getByRole('button', { name: /资料索引/u }).click()
  await page.getByRole('navigation', { name: '页面路径' }).getByRole('button', { name: '资料索引' }).waitFor()
  await button('页面操作').click()
  await dialog().getByRole('button', { name: '移到回收站' }).click()
  assert.equal(await title().inputValue(), '资料索引')
  await button('回收站').click()
  await dialog().getByRole('button', { name: '恢复' }).click()
  assert.equal(await title().inputValue(), '验证子页')

  const input = join(temp, '导入样本.md')
  const output = join(temp, '导出样本.md')
  const raw = '---\r\ntitle: 保留属性\r\n---\r\n\r\n# 原样保存\r\n\r\n[^注]: 内容\r\n'
  await writeFile(input, raw, 'utf8')
  await application.evaluate(({ dialog }, filenames) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filenames.input] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filenames.output })
  }, { input, output })
  await button('导入 Markdown').click()
  await source().waitFor()
  assert.equal(await title().inputValue(), '导入样本')
  assert.equal(await button('富文本').isDisabled(), true)
  await button('导出 Markdown').click()
  await page.getByText('已导出 Markdown', { exact: true }).waitFor()
  assert.equal(await readFile(output, 'utf8'), raw)

  const lastEdit = '# 关闭前的编辑\n\n立即关闭窗口也应该保存这段文字。\n'
  await source().fill(lastEdit)
  await close()
  const data = JSON.parse(await readFile(join(profile, 'workspace.json'), 'utf8'))
  assert.equal(data.pages.find(page => page.id === data.activeId).markdown, lastEdit)

  page = await start()
  assert.equal(await title().inputValue(), '导入样本')
  await body().getByRole('heading', { name: '关闭前的编辑' }).waitFor()
  await exerciseOffice(page, application, temp)
  await close()
  page = await start()
  await verifyOfficeRestart(page)
  assert.deepEqual(appErrors, [])
  await close()
  console.log('Windows 离线验证通过。Markdown、四类办公页面、共享记录视图、文件交换、PDF 分页、放映及关窗重启均已验证。')
} finally {
  if (application) await application.close().catch(() => {})
  if (dirname(temp) === tmpdir() && basename(temp).startsWith('yanye-desktop-')) {
    await rm(temp, { recursive: true, force: true, maxRetries: 5 })
  }
}
