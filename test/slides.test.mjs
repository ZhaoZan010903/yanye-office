import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { moveSlide, newSlide, readDeck, slidesFromDocument } from '../src/modules/slides-model.js'
import { exportPptx } from '../src/modules/slides-pptx.js'

test('大纲生成保留章节顺序、列表和围栏内的标题文本', () => {
  const slides = slidesFromDocument({ title: '评审', markdown: '# 评审\n开场\n## 议程\n  - **议题**\n~~~\n# 不是幻灯片\n~~~\n### 下一步\n收尾' })
  assert.deepEqual(slides.map(s => s.title), ['评审', '议程', '下一步'])
  assert.deepEqual(slides.map(s => s.body), ['开场', '• 议题\n# 不是幻灯片', '收尾'])
  assert.equal(new Set(slides.map(s => s.id)).size, 3)
})

test('页序调整保留页内容、备注与 ID', () => {
  const slides = [newSlide({ title: '甲', notes: '开场' }), newSlide({ title: '乙' })]
  assert.equal(moveSlide(slides, 0, -1), slides)
  assert.deepEqual(moveSlide(slides, 0, 1), [slides[1], slides[0]])
  assert.deepEqual(slides.map(s => s.title), ['甲', '乙'])
  assert.equal(readDeck({}).slides[0].layout, 'cover')
})

test('PPTX 导出独立文字对象、两栏正文、主题和演讲者备注', async () => {
  const slides = [newSlide({ layout: 'columns', title: '评审', body: '方案甲', side: '方案乙', notes: '补充讨论' }), newSlide({ title: '问题' })]
  const data = await exportPptx({ slides, theme: 'mint' }, '测试演示')
  const zip = await JSZip.loadAsync(data, { base64: true })
  const first = await zip.file('ppt/slides/slide1.xml').async('string')
  for (const content of ['评审', '方案甲', '方案乙', 'E9F1EE', 'YanYe columns side']) assert.ok(first.includes(content))
  assert.ok((await zip.file('ppt/slides/slide2.xml').async('string')).includes('问题'))
  assert.ok((await zip.file('ppt/notesSlides/notesSlide1.xml').async('string')).includes('补充讨论'))
})
