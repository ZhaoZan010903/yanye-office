import assert from 'node:assert/strict'
import { openMarkdownFixture } from './markdown-fixture.mjs'

const original = '# 纸上校样\r\n\r\n## 对照表\n\n见 [原稿][work]。\r\n\r\n' +
  '```java\r\nclass Example {}\r\n```\n\n[work]: https://example.org\r\n'
const {page,url,close} = await openMarkdownFixture(original)
try {
  await page.goto(url,{waitUntil:'commit'})
  await page.locator('.writing-area h1').waitFor({timeout:90_000})
  await page.locator('.mode-switch').getByRole('button',{name:'源码'}).click()
  const source = page.getByRole('textbox',{name:'Markdown 源码',exact:true})
  await source.locator('.src-h1').first().waitFor()
  await source.locator('.hljs-keyword').filter({hasText:'class'}).waitFor()
  await page.waitForFunction(()=>{
    const surface=document.querySelector('.md-source-surface')
    const first=[...surface.querySelectorAll('.cm-gutterElement')].find(el=>el.textContent==='1')
    return first && Math.abs(first.getBoundingClientRect().top-surface.querySelector('.cm-line').getBoundingClientRect().top)<2
  })
  assert.equal(await source.evaluate(el=>el.isContentEditable),true)
  assert.equal(await page.locator('.source-editor textarea').count(),0)
  await source.press('Control+Home')
  await source.press('End')
  await page.keyboard.insertText('复核')
  await page.waitForFunction(expected=>window.saved===expected,original.replace('纸上校样','纸上校样复核'))
  await source.press('Control+z')
  await page.waitForFunction(expected=>window.saved===expected,original)
  await source.press('Shift+F10')
  await page.getByRole('menuitem',{name:/全选/}).click()
  await page.waitForFunction(()=>getSelection().toString().includes('[work]: https://example.org'))
  await source.press('Control+Home')
  await source.press('Control+h')
  await page.getByRole('textbox',{name:'查找文字'}).fill('对照表')
  await page.getByRole('textbox',{name:'替换文字'}).fill('进度表')
  await page.getByRole('button',{name:'替换当前'}).click()
  await page.waitForFunction(expected=>window.saved===expected,original.replace('对照表','进度表'))
  await page.getByRole('button',{name:'关闭查找'}).click()
  await page.locator('.mode-switch').getByRole('button',{name:'阅读'}).click()
  await page.locator('.writing-area h2').filter({hasText:'进度表'}).waitFor()
  console.log('源码视图的纸面排版、Markdown 和 Java 高亮、混合换行、撤销、菜单和跨视图替换通过。')
} finally { await close() }
