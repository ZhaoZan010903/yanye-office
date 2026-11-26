import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { WorkspaceDatabase } from './fixtures/v05/workspace-database.mjs'
import { updatePage } from '../shared/workspace.mjs'
import { workspaceDelta } from '../shared/workspace-delta.mjs'

// Exercise the installed WebView runtime and native persistence. The inspector
// belongs only to this test process and its throwaway Windows profile.
const executable = resolve(process.argv[2] || 'src-tauri/target/release/yanye.exe')
await access(executable)
const temp = await mkdtemp(join(tmpdir(), 'yanye-tauri-'))
const profile = join(temp, 'profile')
const source = join(temp, '围栏.md')
const fixture = ['# 离线保存', '', '编辑器写入本机草稿，保存文件时再写回磁盘。', '',
  '```java', 'class Document {', '    boolean isSaved(long revision) {', '        return revision > 0;', '    }', '}', '```',
  '', '```mermaid', 'flowchart LR', 'A[编辑] --> B[本机草稿] --> C[保存文件]', '```', ''].join('\r\n')
await mkdir(profile)
await writeFile(source, fixture)
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRMEAAAAASUVORK5CYII='
await writeFile(join(temp, '示例 1.png'), Buffer.from(png, 'base64'))
await writeFile(join(temp, '下一篇.md'), '# 下一篇')

// The previous storage engine writes a real SQLite database containing an
// unreduced UTF-16 patch; exercising this with JS also checks cross-version ABI.
const legacy = new WorkspaceDatabase(profile)
let before = legacy.workspace
for (const markdown of ['甲\0😀', '甲\0😁']) {
  const next = { ...updatePage(before, 'desk', { markdown }), revision: before.revision + 1 }
  const delta = workspaceDelta(before, next)
  if (markdown.endsWith('😁')) delta.changes[0].text = { start: 3, removed: 1, inserted: '\ude01' }
  legacy.commit([delta])
  before = next
}
legacy.close()

async function eventually(fn, label, timeout = 30_000) {
  const end = Date.now() + timeout
  let failure
  while (Date.now() < end) {
    try { const result = await fn(); if (result) return result } catch (err) { failure = err }
    await delay(120)
  }
  throw new Error(label, { cause: failure })
}

let processUnderTest, browser, activePage
async function start() {
  const portProbe = createServer()
  portProbe.listen(0, '127.0.0.1')
  await once(portProbe, 'listening')
  const port = portProbe.address().port
  portProbe.close()
  await once(portProbe, 'close')
  processUnderTest = spawn(executable, [source], { windowsHide: true, env: {
    ...process.env, YANYE_PROFILE: profile, WEBVIEW2_USER_DATA_FOLDER: join(temp, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port,
  } })
  const ws = await eventually(async () => {
    if (processUnderTest.exitCode !== null) throw Error('砚页提前退出。')
    return (await (await fetch('http://127.0.0.1:' + port + '/json/version')).json()).webSocketDebuggerUrl
  }, '未能连接测试窗口。')
  browser = await chromium.connectOverCDP(ws)
  const page = await eventually(() => browser.contexts()[0]?.pages()[0], '未找到砚页 WebView。')
  activePage = page
  page.on('pageerror', error => console.error('WebView error', error.stack))
  page.on('console', msg => { if (msg.type() === 'error') console.error('WebView console', msg.text().slice(0, 320)) })
  page.setDefaultTimeout(20_000)
  try { await page.getByRole('button', { name: '源码', exact: true }).waitFor() }
  catch (error) { console.error('页面内容', (await page.locator('body').innerText()).slice(0, 900)); throw error }
  return page
}

async function stop() {
  if (processUnderTest?.exitCode === null && !processUnderTest.killed) {
    const exited = once(processUnderTest, 'exit')
    processUnderTest.kill()
    await exited
  }
  await browser?.close().catch(() => {})
  browser = undefined
}

try {
  let page = await start()
  assert.equal(await page.locator('.mode-switch button').count(), 2)
  await page.locator('[data-language="java"] .hljs-keyword').first().waitFor()
  await page.locator('[data-language="mermaid"] img').first().waitFor()
  if (process.env.YANYE_CAPTURE) await page.screenshot({ path: resolve(process.env.YANYE_CAPTURE), scale: 'css' })
  assert.equal(await page.evaluate(async () => (await window.yanye.load()).workspace.pages.find(p => p.id === 'desk').markdown), '甲\0😁')
  const assets = await page.evaluate(async () => {
    const { workspace } = await window.yanye.load()
    const id = workspace.pages.find(p => p.id === workspace.activeId).disk.id
    const picture = await window.yanye.library.markdownResource(id, '示例%201.png')
    const linked = await window.yanye.library.markdownLink(id, '下一篇.md')
    return { picture, content: linked.content }
  })
  assert.deepEqual(assets, { picture: { mime: 'image/png', data: png }, content: '# 下一篇' })
  await page.getByRole('button', { name: '源码', exact: true }).click()
  const text = () => page.getByRole('textbox', { name: 'Markdown 源码' })
  const saved = fixture + '磁盘改动\r\n'
  await text().fill(saved.replaceAll('\r\n', '\n'))
  await page.keyboard.press('Control+s')
  await eventually(async () => (await readFile(source, 'utf8')) === saved, 'Ctrl+S 未保留原换行写回文件。')
  await text().fill((saved + '仅在草稿里').replaceAll('\r\n', '\n'))
  await page.evaluate(() => window.yanye.save())
  await stop()
  page = await start()
  await page.getByRole('button', { name: '源码', exact: true }).click()
  assert.match(await text().inputValue(), /仅在草稿里$/u)
  assert.equal(await readFile(source, 'utf8'), saved)
  console.log('Tauri/WebView2 通过旧数据库读取、资源管理器打开 Markdown、离线高亮与图形、CRLF 写回和异常退出草稿恢复。')
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    console.error('当前工作区', (await activePage.locator('body').innerText()).slice(0, 1200))
    console.error('界面绑定', await activePage.evaluate(async () => {
      const {workspace} = await window.yanye.load()
      const current = workspace.pages.find(p => p.id === workspace.activeId)
      return { activeId: workspace.activeId, title: current?.title, body: current?.markdown.slice(0, 90),
        fences: [...document.querySelectorAll('[data-language]')].map(e => e.getAttribute('data-language')) }
    }).catch(String))
  }
  throw error
} finally {
  await stop()
  await rm(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
}
