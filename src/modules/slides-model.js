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

export function newSlide(overrides = {}) {
  return { id: crypto.randomUUID(), layout: 'text', title: '', body: '', side: '', notes: '', ...overrides }
}

const firstSlide = { id: 'first', layout: 'cover', title: '', body: '', side: '', notes: '' }
const blankDeck = { theme: 'paper', slides: [firstSlide] }

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
