import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { _electron } from 'playwright'
import { addPage, initialWorkspace, makePage } from '../shared/workspace.mjs'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const exe = process.argv[2] ? resolve(process.argv[2]) : createRequire(import.meta.url)('electron')
const temp = await mkdtemp(join(tmpdir(), 'yanye-offline-restart-'))
const profile = join(temp, 'profile')
await mkdir(profile)
const legacyPath = join(profile, 'workspace.json')
const legacy = addPage(initialWorkspace(), makePage({ kind: 'word', id: 'legacy-word', title: '迁移前合同' }))
legacy.revision = 41
const original = JSON.stringify(legacy)
await writeFile(legacyPath, original)
let application

async function start() {
  application = await _electron.launch({ executablePath: exe, args: process.argv[2] ? [] : [root],
    env: { ...process.env, YANYE_PROFILE: profile }, timeout: 20000 })
  const page = await application.firstWindow()
  await page.context().setOffline(true)
  page.setDefaultTimeout(8000)
  return page
}

async function storagePid() {
  return application.evaluate(({ app }) => app.getAppMetrics().find(process =>
    process.type === 'Utility' && [process.name, process.serviceName].includes('YanYe local storage'))?.pid)
}

try {
  let page = await start()
  const button = name => page.getByRole('button', { name, exact: true })
  const title = () => page.getByRole('textbox', { name: '页面标题' })
  const source = () => page.getByRole('textbox', { name: 'Markdown 源码' })
  const saved = () => page.getByText('已保存到本机', { exact: true }).waitFor()
  await button('迁移前合同').waitFor()
  assert.deepEqual(await page.evaluate(async () => (await window.yanye.load()).workspace), legacy)
  await button('新建页面').click()
  await page.getByRole('dialog').getByRole('button', { name: '电子文档', exact: true }).click()
  await title().fill('采购电子文档')
  await button('源码').click()
  await source().fill('断网草稿')
  await saved()
  const snapshotPath = join(temp, '采购初稿.md')
  await application.evaluate(({dialog}, filePath) => { dialog.showSaveDialog = async () => ({canceled:false, filePath}) }, snapshotPath)
  await button('导出文件').click()
  await page.getByText('已导出 采购初稿.md', {exact:true}).waitFor()
  assert.equal(await readFile(snapshotPath,'utf8'), '断网草稿')
  assert.equal(await title().inputValue(), '采购电子文档')
  await page.evaluate(() => {
    window.confirmations = []
    window.yanye.onSave(result => { if (result.state === 'saved') window.confirmations.push(result.revision) })
  })
  // Input lasts several save windows. Confirm intermediate revisions really
  // commit before the typist pauses. Then race an explicit save with more input.
  await source().press('End')
  await source().pressSequentially('abcdefghijklmnopqrstuvwx', { delay: 36 })
  assert.ok(new Set(await page.evaluate(() => window.confirmations)).size >= 2, '持续输入时应该确认中间修订')
  await source().press('Control+s')
  await source().pressSequentially('-after-save')
  await saved()
  const previousPid = await storagePid()
  assert.ok(Number.isSafeInteger(previousPid) && previousPid > 0 && previousPid !== application.process().pid)
  process.kill(previousPid, 'SIGKILL')
  await source().pressSequentially('-recovered')
  await saved()
  const restartedPid = await storagePid()
  assert.ok(restartedPid && restartedPid !== previousPid, '存储进程应该自动重新启动')
  const expected = await source().inputValue()
  const beforeCrash = await page.evaluate(async () => (await window.yanye.load()).workspace)
  assert.equal(beforeCrash.pages.find(p => p.id === beforeCrash.activeId).markdown, expected)

  const ownedPid = application.process().pid
  assert.ok(Number.isSafeInteger(ownedPid) && ownedPid > 0)
  const closed = application.waitForEvent('close', { timeout: 10000 })
  if (process.platform === 'win32') await promisify(execFile)('taskkill.exe', ['/PID', String(ownedPid), '/T', '/F'], { windowsHide: true })
  else application.process().kill('SIGKILL')
  await closed
  application = undefined

  page = await start()
  await button('采购电子文档').click()
  assert.equal(await title().inputValue(), '采购电子文档')
  const afterCrash = await page.evaluate(async () => (await window.yanye.load()).workspace)
  const restored = afterCrash.pages.find(p => p.id === beforeCrash.activeId)
  assert.equal(restored.markdown, expected)
  assert.ok(!restored.disk)
  assert.equal(await readFile(snapshotPath,'utf8'), '断网草稿')
  assert.equal(afterCrash.revision, beforeCrash.revision)
  assert.ok(afterCrash.pages.some(p => p.id === 'legacy-word'))
  assert.equal(await readFile(legacyPath, 'utf8'), original)
  console.log('离线桌面通过：旧版本迁移、新建电子文档、连续输入增量提交、Ctrl+S 后输入、强杀存储进程后继续编辑、强杀本测试应用进程树后重启恢复。')
} finally {
  if (application) await application.close().catch(() => {})
  await rm(temp, { recursive: true, force: true, maxRetries: 5 })
}
