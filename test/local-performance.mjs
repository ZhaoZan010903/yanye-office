import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { arch, cpus, release, tmpdir, totalmem } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron } from 'playwright'
import { addPage, initialWorkspace, makePage } from '../shared/workspace.mjs'
import { WorkspaceDatabase } from './fixtures/v05/workspace-database.mjs'
import { createHash } from 'node:crypto'

// node test/local-performance.mjs path/to/YanYe.exe [output.json] [--extended | --input | --tabs]
const exe = resolve(process.argv[2] || 'release/YanYe-win32-x64/YanYe.exe')
const temp = await mkdtemp(join(tmpdir(), 'yanye-local-perf-'))
const profile = join(temp, 'profile')
const extended = process.argv.includes('--extended')
const tabsOnly = process.argv.includes('--tabs')
const results = {}
const samples = {}
let app, page
const paint = () => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))
function record(name, value) {
  (samples[name] ??= []).push(Math.round(value * 100) / 100)
}
const fixtureName = '预算审阅底稿'
const paragraph = '采购评审需要复核报价并保留原始凭证。'.repeat(60)
const picture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6ioAAAAASUVORK5CYII='
const markdown = Array.from({length:30}, (_, index) => [
  '## 第 ' + (index + 1) + ' 节', paragraph,
  index < 10 ? '| 预算 | 复核 |\n| --- | --- |\n| 7200 | 通过 |' : '',
  index < 5 ? '![图](' + picture + ')' : '',
].filter(Boolean).join('\n\n')).join('\n\n')

async function launch(measure) {
  const start = performance.now()
  app = await _electron.launch({executablePath: exe, env:{...process.env, YANYE_PROFILE:profile}})
  page = await app.firstWindow()
  page.setDefaultTimeout(12000)
  await page.context().setOffline(true)
  const open = page.getByRole('button', {name:'打开本地文件', exact:true})
  await open.waitFor()
  assert.ok(await open.isEnabled())
  await page.evaluate(paint)
  if (measure) record('warmStartupMs', performance.now() - start)
}

async function close() {
  const ended = app.waitForEvent('close', {timeout:12000})
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].close()).catch(() => {})
  await ended
  app = null
}

async function memory(name) {
  const value = await app.evaluate(({app}) => app.getAppMetrics().reduce((n, m) => n + m.memory.privateBytes / 1024, 0))
  record(name, value)
}

async function openDocument() {
  await page.locator('.page-link').getByText(fixtureName, {exact:true}).evaluate(button => button.click())
  await page.getByRole('textbox', {name:'正文编辑器'}).waitFor()
  await page.waitForFunction(() => document.querySelector('.writing-area')?.textContent.includes('第 30 节'))
  await page.evaluate(paint)
}

// Count until two successive frame callbacks after the actual edit, including the
// input dispatch. This upper-bound proxy includes CDP overhead and frame alignment.
async function sampleInput() {
  const cdp = await page.context().newCDPSession(page)
  const editor = page.locator('.writing-area')
  await editor.focus()
  await page.keyboard.press('Control+End')
  const before = await editor.textContent()
  for (const phase of ['insertTextMs', 'compositionCommitMs']) {
    await page.evaluate(() => {
      const editor = document.querySelector('.writing-area')
      window.inputFrameSamples = []
      const onInput = event => {
        if (event.data !== '砚') return
        const start = performance.now()
        requestAnimationFrame(() => {
          if (!editor.lastElementChild?.textContent.endsWith('砚')) throw new Error('正文未呈现输入的汉字')
          requestAnimationFrame(() => window.inputFrameSamples.push(performance.now() - start))
        })
      }
      editor.addEventListener('beforeinput', onInput, true)
      window.stopInputTiming = () => editor.removeEventListener('beforeinput', onInput, true)
    })
    for (let i = 0; i < 200; i++) {
      if (phase === 'compositionCommitMs') await cdp.send('Input.imeSetComposition', {text:'yan', selectionStart:3, selectionEnd:3})
      const start = performance.now()
      await cdp.send('Input.insertText', {text:'砚'})
      await page.evaluate(paint)
      record(phase, performance.now() - start)
    }
    const frames = await page.evaluate(() => { window.stopInputTiming(); return window.inputFrameSamples })
    assert.equal(frames.length, 200, '每次提交须有对应的编辑器输入事件与呈现帧')
    for (const ms of frames) record(phase.replace('Ms','FrameMs'), ms)
    assert.equal((await editor.textContent()).slice(before.length), '砚'.repeat(phase === 'insertTextMs' ? 200 : 400))
  }
  await cdp.detach()
}

async function samplePersistence() {
  const revision = await page.evaluate(async () => (await window.yanye.load()).workspace.revision)
  for (let i = 1; i <= 30; i++) {
    await page.evaluate(target => {
      window.benchmarkSave = new Promise(resolve => {
        const off = window.yanye.onSave(result => {
          if (result.state === 'error' || result.revision >= target) { off(); resolve(result) }
        })
      })
    }, revision + i)
    const start = performance.now()
    await page.keyboard.insertText('墨')
    const result = await page.evaluate(() => window.benchmarkSave)
    assert.equal(result.state, 'saved')
    record('durableEditMs', performance.now() - start)
  }
}

async function sampleKeyFrames() {
  for (const action of ['Backspace', 'Control+z']) {
    await page.evaluate(action => {
      const editor = document.querySelector('.writing-area')
      const frames = []
      function onKey(event) {
        if (action === 'Backspace' ? event.key !== 'Backspace' : !(event.ctrlKey && event.key.toLowerCase() === 'z')) return
        const start = performance.now(), before = editor.lastElementChild.textContent
        requestAnimationFrame(() => {
          if (editor.lastElementChild.textContent === before) return
          requestAnimationFrame(() => frames.push(performance.now()-start))
        })
      }
      editor.addEventListener('keydown',onKey,true)
      window.readKeyFrames = () => { editor.removeEventListener('keydown',onKey,true); return frames }
    }, action)
    for (let i=0; i<200; i++) {
      await page.keyboard.press(action)
      await page.evaluate(paint)
      if (action === 'Control+z') await page.keyboard.press('Control+y')
    }
    const values = await page.evaluate(() => window.readKeyFrames())
    assert.equal(values.length, 200, '退格与撤销按键都须改变可见正文')
    for (const ms of values) record(action === 'Backspace' ? 'backspaceFrameMs' : 'undoFrameMs', ms)
  }
}

async function sampleTabs() {
  for (const [index, name] of ['周报', '评审'].entries()) {
    const filename = join(temp, name + '.md')
    await writeFile(filename, '## ' + name + '\n\n' + paragraph.repeat(3))
    await app.evaluate(({dialog}, filePath) => { dialog.showOpenDialog = async () => ({canceled:false, filePaths:[filePath]}) }, filename)
    await page.keyboard.press('Control+o')
    await page.locator('.disk-tab').nth(index).waitFor()
    await page.getByRole('textbox', {name:'正文编辑器'}).waitFor()
  }
  for (let i = 0; i < 200; i++) {
    const name = i % 2 ? '评审' : '周报'
    const timing = await page.evaluate(async ({name,trace}) => {
      const button = [...document.querySelectorAll('.disk-tab button')].find(b => b.title === name + '.md')
      const start = performance.now()
      button.click()
      const dispatched = trace ? performance.now() : 0
      let firstFrame
      for (let n = 0; n < 180; n++) {
        await new Promise(resolve => requestAnimationFrame(resolve))
        if (trace && n === 0) firstFrame = performance.now()
        const editor = document.querySelector('.writing-area')
        if (editor?.isContentEditable && editor.querySelector('h2')?.textContent === name) {
          const ready = performance.now()
          return {tabSwitchMs:ready-start, ...(trace ? {
            tabClickDispatchMs:dispatched-start, tabWaitFirstFrameMs:firstFrame-dispatched,
            tabFirstFrameToReadyMs:ready-firstFrame, tabFramesToReady:n+1,
          } : {})}
        }
      }
      throw new Error('标签切换后未找到正确正文')
    }, {name,trace:tabsOnly})
    for (const [metric,value] of Object.entries(timing)) record(metric,value)
  }
}

async function sampleLongSession() {
  const body = page.locator('.writing-area')
  await page.bringToFront()
  await body.focus()
  await page.keyboard.press('Control+End')
  const initial = await body.textContent()
  let count = 0
  const start = performance.now()
  while (performance.now() - start < 60_000) {
    await page.keyboard.insertText('墨')
    count++
    await delay(80)
  }
  const afterTyping = await body.textContent()
  assert.ok(afterTyping === initial + '墨'.repeat(count),
    '连续输入校验失败，发送 ' + count + ' 字，正文增加 ' + (afterTyping.length-initial.length) +
    ' 字，第一次插入位置 ' + afterTyping.indexOf('墨') + '，期望 ' + initial.length)
  assert.ok(count >= 200)
  for (let i = 0; i < 200; i++) {
    const t = performance.now()
    await page.keyboard.press('Backspace')
    await page.evaluate(paint)
    record('backspaceMs', performance.now() - t)
  }
  const deleted = await body.textContent()
  assert.equal(deleted, initial + '墨'.repeat(count - 200))
  for (let i = 0; i < 200; i++) {
    const t = performance.now()
    await page.keyboard.press('Control+z')
    await page.evaluate(paint)
    record('undoMs', performance.now() - t)
    assert.notEqual(await body.textContent(), deleted)
    await page.keyboard.press('Control+y')
    assert.equal(await body.textContent(), deleted)
  }
  for (let run = 0; run < 5; run++) {
    const intervals = await page.evaluate(async () => {
      const scroller = document.querySelector('.document-scroll')
      const max = scroller.scrollHeight - scroller.clientHeight
      if (max < 1000) throw new Error('滚动夹具长度不足')
      scroller.scrollTop = 0
      let first, previous
      const samples = []
      return new Promise(resolve => {
        function step(now) {
          first ??= now
          if (previous !== undefined) samples.push(now - previous)
          previous = now
          scroller.scrollTop = Math.min(1, (now - first) / 20000) * max
          if (now - first >= 20000) resolve(samples)
          else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      })
    })
    intervals.forEach(ms => record('scrollFrameMs', ms))
  }
}

async function sampleStartupAndEditing() {
  await launch(false)
  await close()
  for (let i = 0; i < 30; i++) {
    await launch(i < 20)
    if (i === 29) {
      await delay(3000)
      await memory('fileCenterMiB')
    }
    const start = performance.now()
    await openDocument()
    record('workspaceFirstEditorMs', performance.now() - start)
    if (i === 29) break
    await page.getByRole('button', {name:'返回文件中心', exact:true}).click()
    await close()
  }
  await delay(1500)
  await memory('documentMiB')
  await sampleInput()
  await page.evaluate(() => window.yanye.save())
  await samplePersistence()
  await sampleTabs()
}

try {
  await mkdir(profile)
  const seed = addPage(initialWorkspace(), makePage({id:'benchmark', title:fixtureName, markdown}))
  await writeFile(join(profile,'workspace.json'), JSON.stringify(seed))
  new WorkspaceDatabase(profile).close()
  if (extended) {
    await launch(false)
    await openDocument()
    await sampleLongSession()
  } else if (tabsOnly) {
    await launch(false)
    await openDocument()
    await page.bringToFront()
    await sampleTabs()
  } else if (process.argv.includes('--input')) {
    await launch(false)
    await openDocument()
    await page.bringToFront()
    await sampleInput()
    await sampleKeyFrames()
  } else {
    await sampleStartupAndEditing()
  }
} finally {
  if (app) await app.close().catch(() => {})
  for (const [name, values] of Object.entries(samples)) {
    const sorted = [...values].sort((a,b) => a-b)
    results[name] = {n: values.length, p50: sorted[Math.ceil(sorted.length*.5)-1], p95: sorted[Math.ceil(sorted.length*.95)-1], max:sorted.at(-1)}
  }
  console.log(JSON.stringify({executable:basename(exe), markdownLength:markdown.length, results}, null, 2))
  const fixture = {characters:markdown.length, sha256:createHash('sha256').update(markdown).digest('hex')}
  const machine = {cpu:cpus()[0].model, os:release(), arch:arch(), memoryGiB:+(totalmem()/2**30).toFixed(1)}
  const asarSha256 = createHash('sha256').update(await readFile(join(dirname(exe),'resources','app.asar'))).digest('hex')
  if (process.argv[3] && !process.argv[3].startsWith('--')) await writeFile(resolve(process.argv[3]), JSON.stringify({fixture, machine, asarSha256, results, samples}, null, 2) + '\n')
  if (dirname(temp) === tmpdir() && basename(temp).startsWith('yanye-local-perf-')) await rm(temp, {recursive:true, force:true, maxRetries:5})
}
