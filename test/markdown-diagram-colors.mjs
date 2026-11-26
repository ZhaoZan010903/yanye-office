import assert from 'node:assert/strict'
import { openMarkdownFixture } from './markdown-fixture.mjs'

const blocks = [
  {language:'flow',text:'st=>start: 初稿\nreview=>operation: 编辑复核\nst->review',
    tokens:[['title','st'],['built_in','=>'],['keyword','operation'],['built_in','->'],['string','初稿']]},
  {language:'sequence',text:'participant 校对员 as B\n作者-->>B: 初稿：第二版\nNote right of B: 复核',
    tokens:[['keyword','participant'],['title','校对员'],['keyword','as'],['title','作者'],['built_in','-->>'],['string','初稿：第二版'],['keyword','Note right of']]},
]
const sample = '# 着色校样\r\n\r\n' + blocks.map(({language,text})=>
  '```'+language+'\r\n'+text.replaceAll('\n','\r\n')+'\r\n```').join('\n\n')+'\r\n'
const {page,url,close} = await openMarkdownFixture(sample)
async function assertTokens(root,tokens) {
  for (const [scope,value] of tokens) {
    const hits = root.locator('.hljs-'+scope).filter({hasText:value})
    await hits.first().waitFor()
    assert.ok((await hits.allTextContents()).includes(value),scope+' '+value)
  }
}
try {
  await page.goto(url,{waitUntil:'commit'})
  await page.locator('.writing-area h1').waitFor({timeout:90_000})
  for (const {language,text,tokens} of blocks) {
    const fence = page.locator('.writing-area [data-language="'+language+'"]')
    await fence.getByRole('button',{name:'编辑此块源码'}).click()
    const source=fence.locator('pre')
    await assertTokens(source,tokens)
    assert.equal(await source.textContent(),text)
    await fence.getByRole('button',{name:'预览此块'}).click()
  }
  await page.locator('.mode-switch').getByRole('button',{name:'源码'}).click()
  const plain=page.getByRole('textbox',{name:'Markdown 源码',exact:true})
  for (const {tokens} of blocks) await assertTokens(plain,tokens)
  const painted = await plain.evaluate(root => ['title','built_in','keyword','string'].map(scope=>{
    let token = root.querySelector('.hljs-'+scope)
    while (token.firstElementChild) token = token.firstElementChild
    return getComputedStyle(token).color
  }))
  assert.equal(new Set(painted).size,4,'四类标记实际绘制的颜色必须不同。')
  assert.equal(await page.evaluate(()=>window.saved),sample)
  console.log('flow / sequence 在源码模式和围栏编辑中均有分色，源文和混合换行逐字一致。')
} finally { await close() }
