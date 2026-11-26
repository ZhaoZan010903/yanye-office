import assert from 'node:assert/strict'
import { openMarkdownFixture } from './markdown-fixture.mjs'

const fixture = '---\r\ntitle: 备忘\r\n---\r\n\r\n# 原稿 ###\n\n' +
  '~~~Java  title="demo"\r\npublic class Demo {}\r\n~~~\n\n' +
  '```mermaid\nflowchart LR\n  A --> B\n```\n\n' +
  '$$\nx^2\n$$\n\n内含 $y+1$。\n\n' +
  '~~~~unknown-lang\n```\n~~~~\r\n\r\n' +
  '| A | B |\n| --- | --- |\n| one | two |\n\n* 一\n* 二\n\n' +
  '配图 ![像素](assets/a.png) 和 [下一篇](next.md)。\n\n尾段\r\n'
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ya8AAAAASUVORK5CYII='
const {page,url,close} = await openMarkdownFixture(fixture,pixel)
try {
  const errors=[]
  page.on('pageerror',e=>{errors.push(String(e));console.error(e.message)})
  page.on('console',m=>{if(m.type()==='error')console.error(m.text())})
  const button = name => page.getByRole('button',{name,exact:true})
  const reading = page.getByRole('textbox',{name:'正文编辑器'})
  await page.goto(url,{waitUntil:'commit'})
  await reading.locator('h1').waitFor({timeout:120000})
  assert.equal(await page.locator('.mode-switch button').count(),2)
  assert.equal(await button('阅读').getAttribute('aria-pressed'),'true')
  await reading.locator('[data-language="java"] .hljs-keyword').first().waitFor()
  await reading.locator('[data-language="mermaid"] img').waitFor()
  await reading.locator('[data-source-kind="math"] .katex').waitFor()
  await reading.locator('.md-inline-math .katex').waitFor()
  await page.waitForFunction(()=>document.querySelector('.md-image img')?.naturalWidth === 1)
  assert.deepEqual(await page.evaluate(()=>window.resource),['local','assets/a.png'])
  await reading.getByRole('link',{name:'下一篇'}).click({modifiers:['Control']})
  assert.equal(await page.evaluate(()=>window.link),'next.md')
  assert.equal(await reading.locator('table td').count(),2)
  assert.deepEqual(await reading.locator('ul li').allTextContents(),['一','二'])
  await reading.getByRole('cell',{name:'one'}).click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('!')
  await page.waitForFunction(()=>window.saved.includes('one!'))
  assert.equal(await page.evaluate(()=>window.saved),fixture.replace('one','one!'))
  await page.keyboard.press('Control+z')
  await page.waitForFunction(f=>window.saved===f,fixture)
  await button('源码').click()
  await button('阅读').click()
  assert.equal(await page.evaluate(()=>window.saved),fixture)

  // Editing a paragraph must not rewrite adjacent delimiters, casing, spaces,
  // the YAML header, a fence containing backticks, or the mixed line endings.
  await reading.getByText('尾段',{exact:true}).click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('改')
  await page.waitForFunction(()=>window.saved.endsWith('尾段改\r\n'))
  assert.equal(await page.evaluate(()=>window.saved),fixture.replace('尾段','尾段改'))
  await page.keyboard.press('Control+z')
  await page.waitForFunction(f=>window.saved===f,fixture)

  const java = reading.locator('[data-language="java"]')
  const picker = java.getByRole('combobox')
  await picker.fill('py')
  await java.getByRole('option',{name:'python',exact:true}).click()
  await page.waitForFunction(()=>window.saved.includes('~~~python  title="demo"'))
  const mermaid=reading.locator('[data-language="mermaid"]')
  await mermaid.getByRole('button',{name:'编辑此块源码'}).click()
  await mermaid.locator('pre:visible').waitFor()
  await page.keyboard.press('Home')
  await page.keyboard.insertText('invalid ')
  await mermaid.getByRole('button',{name:'预览此块'}).click()
  await mermaid.getByRole('alert').waitFor()
  await mermaid.getByRole('button',{name:'编辑此块源码'}).click()
  assert.match(await mermaid.locator('pre').innerText(),/invalid/u)

  await reading.getByText('尾段',{exact:true}).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('```py')
  await page.getByRole('listbox',{name:'围栏语言补全'}).getByRole('option',{name:'python',exact:true}).waitFor()
  await page.keyboard.press('Tab')
  await reading.locator('[data-language="python"] pre').last().waitFor()
  await page.keyboard.press('Control+Enter')
  await page.keyboard.insertText('```c++')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('int value;')
  await reading.locator('[data-language="c++"] pre').getByText('int value;',{exact:false}).waitFor()
  assert.match(await page.evaluate(()=>window.saved),/```c\+\+\r?\nint value;\r?\n```/u)
  await reading.getByText('尾段',{exact:true}).click()
  await page.evaluate(base64=>{
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0))
    const transfer=new DataTransfer()
    transfer.items.add(new File([bytes],'粘贴.png',{type:'image/png'}))
    document.querySelector('.writing-area').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}))
  },pixel)
  await reading.getByRole('img',{name:'粘贴.png'}).waitFor()
  assert.match(await page.evaluate(()=>window.saved),/!\[粘贴\.png\]\(data:image\/png;base64,/u)
  await reading.locator('h1').scrollIntoViewIfNeeded()
  await reading.evaluate((el,base64)=>{
    const target=el.querySelector('h1').getBoundingClientRect()
    const transfer=new DataTransfer()
    transfer.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'拖入.png',{type:'image/png'}))
    el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:target.x+3,clientY:target.y+3}))
  },pixel)
  await reading.getByRole('img',{name:'拖入.png'}).waitFor()
  const cell = reading.locator('td').first()
  await cell.click({button:'right'})
  await page.getByRole('menuitem',{name:'表格',exact:true}).click()
  await page.getByRole('menuitem',{name:'右侧插入列'}).click()
  assert.equal(await reading.locator('th').count(),3)
  await cell.hover()
  await button('居中对齐').click()
  await page.waitForFunction(()=>/:-+:/u.test(window.saved))
  // Changing column alignment replaces cell DOM nodes. The next hover
  // must attach to the new cell and expose its table-size controls.
  await cell.hover()
  await button('调整表格').click()
  const sizing = page.getByRole('toolbar',{name:'表格浮动工具'})
  await sizing.getByLabel('行',{exact:true}).fill('4')
  await sizing.getByRole('button',{name:'应用'}).click()
  assert.equal(await reading.locator('tr').count(),4)
  assert.deepEqual(errors,[])
  console.log('Passed editable reading, code completion and colors, Mermaid, math, relative image/link binding, image paste/drop, GFM tables and lists, and mixed-EOL Markdown preservation.')
} catch (error) {
  console.error(await page?.locator('.md-fence').evaluateAll(nodes => nodes.map(el => ({ language:el.dataset.language,
    kind:el.dataset.sourceKind, text:el.innerText.slice(0,150), rendered:!!el.querySelector('.katex')}))))
  throw error
} finally {
  await close()
}
