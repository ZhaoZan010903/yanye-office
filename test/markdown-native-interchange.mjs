import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { desktopSession, eventually } from './desktop-session.mjs'

const executable = resolve(process.argv[2] || 'src-tauri/target/release/yanye.exe')
const temp = await mkdtemp(join(tmpdir(), 'yanye-md07-'))
const profile = join(temp, 'profile')
await mkdir(profile)
const source = process.argv[3] ? resolve(process.argv[3]) : join(temp,'归档校样.md')
if (!process.argv[3]) {
  const fixture = await readFile(new URL('./fixtures/markdown-interop.md',import.meta.url),'utf8')
  await writeFile(source, fixture.replace(/\r?\n/g,'\r\n'))
}
const before = await readFile(source,'utf8')
const verifyFinal = process.argv[4] === '--verify-final'
const suffix = '砚页复核。'
// An explicitly supplied file must be the disposable interchange sample.
assert.ok(before.startsWith('# 归档校样') && before.includes('[^ink]:') && before.includes(suffix) === verifyFinal)
const sentence = '本次校对使用同一份文稿。'
const expected = verifyFinal ? before : before.replace(sentence,sentence + suffix)
if (!verifyFinal) assert.notEqual(expected,before)
const { start, stop } = desktopSession({executable,source,profile,temp})
const digest = s=>createHash('sha256').update(s).digest('hex')
try {
  const page = await start()
  const reading = page.getByRole('textbox',{name:'正文编辑器'})
  await reading.locator('[data-note-ref="ink"]').nth(1).waitFor()
  if (verifyFinal) {
    assert.equal(await reading.locator('h1').innerText(),'归档校样 · 初校 · 定稿')
    assert.ok((await reading.innerText()).includes(sentence + suffix))
  }
  await reading.locator('[data-note-ref="ink"]').nth(1).click()
  await reading.locator('[data-note-back="ink"]').last().click()
  for (const lang of ['flow','sequence']) {
    const img = reading.locator('[data-language="'+lang+'"] img')
    await img.waitFor()
    assert.ok(await img.evaluate(async i=>{ await i.decode();return i.naturalWidth>40 && i.naturalHeight>40 }))
  }
  assert.equal(await reading.locator('a[data-reference-label][href="https://example.org/handbook"]').count(),2)
  if (!verifyFinal) {
    const record = reading.locator('p').filter({hasText:sentence}).first()
    await record.click()
    await record.evaluate((p,text)=>{
      const walker = document.createTreeWalker(p,NodeFilter.SHOW_TEXT)
      for (let node=walker.nextNode(); node; node=walker.nextNode()) {
        const at=node.textContent.indexOf(text)
        if (at!==-1) { getSelection().collapse(node,at+text.length); return }
      }
      throw Error('未找到待编辑的校样正文。')
    },sentence)
    await page.keyboard.insertText(suffix)
    await page.keyboard.press('Control+s')
  }
  try {
    await eventually(async ()=>(await readFile(source,'utf8'))===expected,'磁盘正文或原始语法发生意外变化。',4500)
  } catch(error) {
    const actual=await readFile(source,'utf8')
    const offset=[...Array(Math.max(actual.length,expected.length)).keys()].find(i=>actual[i]!==expected[i]) ?? 0
    throw new Error(JSON.stringify({offset,expected:expected.slice(Math.max(0,offset-18),offset+40),actual:actual.slice(Math.max(0,offset-18),offset+40),status:await page.locator('.status-bar').innerText()}),{cause:error})
  }
  await page.locator('.mode-switch').getByRole('button',{name:'源码'}).click()
  const raw = page.getByRole('textbox',{name:'Markdown 源码'})
  await raw.locator('.src-h1').first().waitFor()
  await raw.press('Control+Home')
  if (process.env.YANYE_CAPTURE_SOURCE) {
    await raw.locator('.hljs-keyword').filter({hasText:'start'}).first().waitFor()
    await page.screenshot({path:resolve(process.env.YANYE_CAPTURE_SOURCE),scale:'css'})
  }
  if (!verifyFinal) await page.keyboard.press('Control+s')
  assert.equal(await readFile(source,'utf8'),expected)
  console.log(JSON.stringify({source, before:digest(before), after:digest(expected), bytes:Buffer.byteLength(expected),
    assertions:['footnote return','two reference links','flow SVG','sequence SVG','source pane',
      verifyFinal ? 'reopened Typora final without editing' : 'isolated edit; other bytes identical']}))
} finally { await stop(); await rm(temp,{recursive:true,force:true,maxRetries:8,retryDelay:250}) }
