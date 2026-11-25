import { newSlide, slideBoxes, slideThemes } from './slides-model.js'

const W = 40 / 3
const H = 7.5
const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function pageBox(box) {
  return { x: box.x * W, y: box.y * H, w: box.w * W, h: box.h * H }
}

export async function exportPptx(deck, name) {
  const { default: PowerPoint } = await import('pptxgenjs')
  const file = new PowerPoint()
  file.layout = 'LAYOUT_WIDE'
  file.title = name
  file.author = '砚页'
  file.lang = 'zh-CN'
  const theme = slideThemes[deck.theme] || slideThemes.paper
  for (const item of deck.slides) {
    const slide = file.addSlide()
    slide.background = { color: theme.background }
    const boxes = slideBoxes(item.layout)
    const baseText = { fontFace: 'Microsoft YaHei', color: theme.ink, margin: 0, valign: 'top', fit: 'shrink', breakLine: false }
    const addText = (field, options) => slide.addText(item[field] || '', {
      ...baseText, ...pageBox(boxes[field]), ...options, objectName: 'YanYe ' + item.layout + ' ' + field,
    })
    addText('title', { fontSize: item.layout === 'cover' ? 46 : 36, bold: true })
    addText('body', { fontSize: 22 })
    if (item.layout === 'columns') addText('side', { fontSize: 22 })
    if (item.layout === 'image' && item.image) {
      const box = pageBox(boxes.side)
      const image = item.image
      const scale = Math.min(box.w / image.width, box.h / image.height)
      const w = image.width * scale, h = image.height * scale
      slide.addImage({ data: image.data, x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h, altText: image.name || '插图' })
    }
    if (item.notes) slide.addNotes(item.notes)
  }
  return file.write({ outputType: 'base64', compression: true })
}

function nodes(root, tag) {
  return [...root.getElementsByTagNameNS('*', tag)]
}

function shapeText(shape) {
  return nodes(shape, 'p').map(p => [...p.getElementsByTagName('*')]
    .map(node => node.localName === 't' ? node.textContent : node.localName === 'br' ? '\n' : '').join('')).join('\n')
}

function relationships(doc, source) {
  const result = new Map()
  for (const rel of nodes(doc, 'Relationship')) {
    if (rel.getAttribute('TargetMode') === 'External') continue
    const url = new URL(rel.getAttribute('Target'), 'https://package.invalid/' + source)
    if (url.origin === 'https://package.invalid') result.set(rel.id || rel.getAttribute('Id'), {
      path: decodeURIComponent(url.pathname.slice(1)), type: rel.getAttribute('Type').split('/').pop(),
    })
  }
  return result
}

function relsPath(file) {
  const slash = file.lastIndexOf('/') + 1
  return file.slice(0, slash) + '_rels/' + file.slice(slash) + '.rels'
}

export async function loadImage(data, name) {
  const info = new Image()
  info.src = data
  await info.decode()
  return { name, data, width: info.naturalWidth, height: info.naturalHeight }
}

export async function importPptx(base64) {
  const { default: Zip } = await import('jszip')
  const file = await Zip.loadAsync(base64, { base64: true })
  const parser = new DOMParser()
  let remaining = 32 * 1024 * 1024
  async function bytes(path, limit) {
    const entry = file.file(path)
    if (!entry) throw new Error('演示文件中缺少 ' + path)
    const stream = entry.internalStream('uint8array')
    const chunks = []
    let length = 0
    return new Promise((resolve, reject) => {
      stream.on('data', chunk => {
        length += chunk.length
        remaining -= chunk.length
        if (length > limit || remaining < 0) {
          stream.pause()
          reject(new Error('此演示文稿的解压内容超过导入容量。'))
        } else chunks.push(chunk)
      })
      stream.on('error', reject)
      stream.on('end', () => {
        const output = new Uint8Array(length)
        let offset = 0
        for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }
        resolve(output)
      })
      stream.resume()
    })
  }
  async function xml(path) {
    const doc = parser.parseFromString(new TextDecoder().decode(await bytes(path, 4 * 1024 * 1024)), 'application/xml')
    if (nodes(doc, 'parsererror').length) throw new Error('PPTX 内部文档无法读取。')
    return doc
  }
  const pres = 'ppt/presentation.xml'
  const presentation = await xml(pres)
  const catalog = relationships(await xml(relsPath(pres)), pres)
  const slides = []
  let theme = 'paper'
  for (const entry of nodes(presentation, 'sldId')) {
    const path = catalog.get(entry.getAttributeNS(ns, 'id'))?.path
    if (!path) throw new Error('幻灯片顺序信息不完整。')
    const content = await xml(path)
    const backgroundColor = nodes(content, 'bg')[0]?.getElementsByTagNameNS('*', 'srgbClr')[0]?.getAttribute('val')
    if (!slides.length) theme = Object.keys(slideThemes).find(key => slideThemes[key].background === backgroundColor) || 'paper'
    const related = file.file(relsPath(path)) ? relationships(await xml(relsPath(path)), path) : new Map()
    const shapes = nodes(content, 'sp').map(sp => ({
      kind: nodes(sp, 'ph')[0]?.getAttribute('type'),
      name: nodes(sp, 'cNvPr')[0]?.getAttribute('name') || '',
      text: shapeText(sp),
    }))
    const title = shapes.find(s => /^YanYe (cover|text|columns|image) title$/.test(s.name))
      || shapes.find(s => ['ctrTitle', 'title'].includes(s.kind)) || shapes.find(s => s.text.trim())
    const layout = /^YanYe (cover|text|columns|image) title$/.exec(title?.name || '')?.[1] || 'text'
    const rest = shapes.filter(s => s !== title && !['dt', 'ftr', 'sldNum'].includes(s.kind))
    const body = rest.find(s => s.name === 'YanYe ' + layout + ' body')
    const side = rest.find(s => s.name === 'YanYe columns side')
    const item = newSlide({ layout, title: title?.text || '', body: body ? body.text : rest.map(s => s.text).filter(Boolean).join('\n\n'), side: side?.text || '' })
    for (const pic of nodes(content, 'pic')) {
      const id = nodes(pic, 'blip')[0]?.getAttributeNS(ns, 'embed')
      const imagePath = related.get(id)?.path
      if (!imagePath || !/\.(png|jpe?g)$/i.test(imagePath)) continue
      const blob = new Blob([await bytes(imagePath, 8 * 1024 * 1024)], { type: /\.png$/i.test(imagePath) ? 'image/png' : 'image/jpeg' })
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      item.image = await loadImage(data, imagePath.split('/').pop())
      if (item.layout === 'text') item.layout = 'image'
      break
    }
    const notes = [...related.values()].find(rel => rel.type === 'notesSlide')
    if (notes) {
      const notesDoc = await xml(notes.path)
      item.notes = nodes(notesDoc, 'sp').filter(s => nodes(s, 'ph')[0]?.getAttribute('type') === 'body').map(shapeText).join('\n').trim()
    }
    slides.push(item)
  }
  if (!slides.length) throw new Error('没有找到可导入的幻灯片。')
  return { theme, slides }
}
