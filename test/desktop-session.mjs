import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { join } from 'node:path'

export async function eventually(fn, label, timeout = 30_000) {
  const end = Date.now() + timeout
  let failure
  while (Date.now() < end) {
    try { const result = await fn(); if (result) return result } catch (err) { failure = err }
    await delay(120)
  }
  throw new Error(label, { cause: failure })
}

export function desktopSession({ executable, source, profile, temp }) {
  let processUnderTest, browser
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
    page.on('pageerror', error => console.error('WebView error', error.stack))
    page.on('console', msg => { if (msg.type() === 'error') console.error('WebView console', msg.text().slice(0, 320)) })
    page.setDefaultTimeout(20_000)
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
  return { start, stop }
}
