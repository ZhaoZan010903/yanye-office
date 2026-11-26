export const slideLayouts = {
  cover: '封面',
  text: '标题与正文',
  columns: '两栏',
  image: '图文',
}

export const slideThemes = {
  paper: { name: '纸白', background: 'FFFFFF', ink: '37352F', accent: '806B4C' },
  mint: { name: '浅青', background: 'E9F1EE', ink: '253B35', accent: '4F7368' },
  midnight: { name: '夜蓝', background: '202F43', ink: 'FAF7EF', accent: 'B3C9DD' },
}

export const shapeKinds = { rect:'矩形', roundRect:'圆角矩形', ellipse:'椭圆', triangle:'三角形', diamond:'菱形', rightArrow:'右箭头' }
const hex = (value, fallback) => /^[0-9A-F]{6}$/i.test(value) ? value.toUpperCase() : fallback

export function newSlide(overrides = {}) {
  return { id: crypto.randomUUID(), layout: 'text', title: '', body: '', side: '', notes: '', ...overrides }
}

const firstSlide = { id: 'first', layout: 'cover', title: '', body: '', side: '', notes: '' }
const blankDeck = { theme: 'paper', slides: [firstSlide] }

export function textBox(values = {}) {
  const bounded = (number, fallback, min, max) => Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
  const w = bounded(values.w, .38, .04, 1), h = bounded(values.h, .15, .04, 1)
  return {
    id: values.id || crypto.randomUUID(), text: String(values.text ?? ''),
    x: bounded(values.x ?? .12, 0, 0, 1-w), y: bounded(values.y ?? .45, 0, 0, 1-h), w, h,
    color: hex(values.color,'37352F'),
    fontSize: bounded(values.fontSize, 22, 6, 144),
    fontFace: String(values.fontFace || 'Microsoft YaHei').slice(0,100), bold:!!values.bold, italic:!!values.italic,
    align: ['left','center','right'].includes(values.align) ? values.align : 'left',
  }
}

export function slideShape(values = {}) {
  const box = textBox({ x:.35,y:.36,w:.26,h:.22,fontSize:18, ...values })
  return { ...box, kind:Object.hasOwn(shapeKinds,values.kind) ? values.kind : 'rect',
    fill:hex(values.fill,'D8E9EB'), stroke:hex(values.stroke,'54838B'),
    rotation:Number.isFinite(values.rotation) ? (values.rotation % 360 + 360) % 360 : 0 }
}

export function readDeck(value) {
  return value && Array.isArray(value.slides) && value.slides.length ? value : blankDeck
}

export function moveSlide(slides, index, direction) {
  const destination = index + direction
  if (index < 0 || index >= slides.length || destination < 0 || destination >= slides.length) return slides
  const ordered = slides.slice()
  ordered.splice(destination, 0, ordered.splice(index, 1)[0])
  return ordered
}

function plainText(line) {
  return line.replace(/!?\[([^\]]+)\]\([^)]+\)/gu, '$1').replace(/(\*\*|__)(.+?)\1/gu, '$2')
    .replace(/^\s*[-*+]\s+/u, '• ').replace(/^>\s?/u, '')
}

export function slidesFromDocument(page) {
  const slides = [newSlide({ layout: 'cover', title: page.title || '未命名文档' })]
  let lines = []
  let fence = ''
  function finish() {
    slides[slides.length - 1].body = lines.join('\n').trim()
    lines = []
  }
  for (const line of (page.markdown || '').split(/\r?\n/u)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1]
    if (marker && !fence) { fence = marker; continue }
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length) fence = ''
      else lines.push(line)
      continue
    }
    const heading = /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/u.exec(line)
    if (!heading) { lines.push(plainText(line)); continue }
    const title = plainText(heading[1])
    if (slides.length === 1 && title === slides[0].title && !lines.join('').trim()) continue
    finish()
    slides.push(newSlide({ title }))
  }
  finish()
  return slides
}

// The same relative boxes drive the editor, slide show and PowerPoint output.
export function slideBoxes(layout) {
  const title = { x: 0.07, y: 0.11, w: 0.86, h: 0.18 }
  const body = { x: 0.07, y: 0.36, w: 0.86, h: 0.53 }
  if (layout === 'cover') return {
    title: { ...title, y: 0.29, h: 0.27 }, body: { ...body, y: 0.62, h: 0.26 },
  }
  if (layout === 'columns' || layout === 'image') return {
    title, body: { ...body, w: 0.40 }, side: { ...body, x: 0.53, w: 0.40 },
  }
  return { title, body }
}
