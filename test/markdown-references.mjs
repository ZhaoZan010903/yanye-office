import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { openMarkdownFixture } from './markdown-fixture.mjs'

const sample = await readFile(new URL('./fixtures/markdown-interop.md',import.meta.url),'utf8')
const extra = '\r\n[Manual][] 和 [Manual]，以及 `[^ink]`。另见[^long]。\n\n[manual]: next.md\n\n' +
  '![校样][picture]\n\n[picture]: assets/preview.png\n\n[^long]: 首段\r\n\r\n    第二段含 **强调**。\n'
const fixture = sample + extra
const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ya8AAAAASUVORK5CYII='
const {page,url,close} = await openMarkdownFixture(fixture,pixel)
try {
  await page.goto(url,{waitUntil:'commit'})
  const reading = page.getByRole('textbox',{name:'正文编辑器'})
  await reading.locator('[data-note-ref]').first().waitFor({timeout:120000})
  assert.equal(await reading.locator('[data-note-ref]').count(),3)
  await reading.getByRole('img',{name:'校样'}).waitFor()
  assert.deepEqual(await page.evaluate(()=>window.resource),['local','assets/preview.png'])
  assert.equal(await reading.locator('[data-note-def="long"] p').count(),2)
  assert.equal(await reading.locator('[data-note-def="long"] strong').innerText(),'强调')
  const refs = reading.locator('[data-note-ref="ink"]')
  assert.equal(await refs.nth(1).getAttribute('data-citation'),'1')
  await refs.nth(1).click()
  const selectedInsideNote = () => page.evaluate(()=>Boolean(window.getSelection()?.anchorNode?.parentElement?.closest('[data-note-def]')))
  assert.ok(await selectedInsideNote())
  await reading.getByRole('button',{name:'返回脚注引用 ink'}).click()
  assert.ok(await page.evaluate(()=>{
    const selection = window.getSelection(), node = selection.anchorNode
    const before = node.nodeType === Node.TEXT_NODE ? node.previousSibling : node.childNodes[selection.anchorOffset-1]
    return before === document.querySelectorAll('[data-note-ref]')[1]
  }))
  for (const text of ['排版手册','同一本手册']) {
    const link = reading.getByRole('link',{name:text,exact:true})
    assert.equal(await link.getAttribute('href'),'https://example.org/handbook')
    await link.click({modifiers:['Control']})
    assert.equal(await page.evaluate(()=>window.external),'https://example.org/handbook')
  }
  assert.deepEqual(await reading.getByRole('link',{name:'Manual',exact:true}).evaluateAll(links=>links.map(a=>a.getAttribute('href'))),['next.md','next.md'])
  await reading.locator('[data-note-def="ink"] p').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('续。')
  await page.waitForFunction(()=>window.saved.includes('引用。续。'))
  assert.equal(await page.evaluate(()=>window.saved),fixture.replace('两处引用。','两处引用。续。'))
  await page.keyboard.press('Control+z')
  await page.waitForFunction(s=>window.saved===s,fixture)
  for (const [lang,words] of [['flow',['起草','校对正文','通过？','归档']],['sequence',['稿件复核','作者','编辑','提交初稿','对照原文','返回意见']]]) {
    const img = reading.locator('[data-language="'+lang+'"] img')
    await img.waitFor()
    const labels = await img.evaluate(async image=>{
      await image.decode()
      if (image.naturalWidth<20 || image.naturalHeight<20) throw Error('预览尺寸无效。')
      const svg=new DOMParser().parseFromString(decodeURIComponent(image.src.slice(image.src.indexOf(',')+1)),'image/svg+xml')
      return svg.documentElement.textContent
    })
    for (const word of words) assert.ok(labels.includes(word),lang+' misses '+word)
  }
  const def = reading.locator('.md-link-definition').first()
  await def.click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.insertText('[guide]: relative.md "新手册"')
  const linked = reading.getByRole('link',{name:'同一本手册',exact:true})
  assert.equal(await linked.getAttribute('href'),'relative.md')
  await linked.click({modifiers:['Control']})
  assert.equal(await page.evaluate(()=>window.link),'relative.md')
  assert.equal(await page.evaluate(()=>window.saved),fixture.replace('[guide]: https://example.org/handbook "排版手册"','[guide]: relative.md "新手册"'))
  console.log('Passed footnote jump and exact return, linked and shortcut references, live retarget, editable footnotes, flow and sequence SVG, and lossless mixed-line-ending edits.')
} catch(error) {
  console.error((await page.locator('.writing-area').innerHTML().catch(()=>'' )).slice(0,5400))
  throw error
} finally { await close() }
