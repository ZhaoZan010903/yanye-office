import { newSlide, shapeKinds, slideBoxes, slideShape, slideThemes, textBox } from './slides-model.js'
import { parseTransition, transitionXml } from './slide-transition.js'

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
    if (item.titleBox) {
      const box=item.titleBox
      slide.addText(item.title || '',{...baseText,...pageBox(box),fontSize:box.fontSize,fontFace:box.fontFace,color:box.color,
        bold:box.bold,italic:box.italic,align:box.align,objectName:'YanYe '+item.layout+' positioned title'})
    } else addText('title', { fontSize: item.layout === 'cover' ? 46 : 36, bold: true })
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
    for (const shape of item.shapes || []) {
      slide.addText(shape.text, { ...baseText, ...pageBox(shape), shape:shape.kind, rotate:shape.rotation,
        fill:{color:shape.fill}, line:{color:shape.stroke,width:1}, color:shape.color, fontSize:shape.fontSize,
        fontFace:shape.fontFace, bold:shape.bold, italic:shape.italic, align:'center', valign:'middle', objectName:'YanYe shape' })
    }
    for (const box of item.textBoxes || []) {
      slide.addText(box.text, { ...baseText, ...pageBox(box), fontSize: box.fontSize, color: box.color,
        fontFace:box.fontFace || baseText.fontFace, bold:box.bold, italic:box.italic, align:box.align,
        fit: undefined, objectName: 'YanYe text box' })
    }
  }
  const effects=deck.slides.map(item=>transitionXml(item.transition || {}))
  if (!effects.some(Boolean)) return file.write({ outputType:'base64',compression:true })
  const {default:Zip}=await import('jszip')
  const pack=await Zip.loadAsync(await file.write({ outputType:'uint8array' }))
  for (const [index,effect] of effects.entries()) {
    if (!effect) continue
    const path='ppt/slides/slide'+(index+1)+'.xml'
    const xml=await pack.file(path).async('string')
    // Our pptxgenjs slide ends with a color map override. The transition follows it.
    if (!xml.includes('</p:clrMapOvr>')) throw new Error('无法定位幻灯片的配色映射。')
    pack.file(path,xml.replace('</p:clrMapOvr>','</p:clrMapOvr>'+effect))
  }
  return pack.generateAsync({type:'base64',compression:'DEFLATE'})
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
  const size = nodes(presentation, 'sldSz')[0]
  const slideWidth = Number(size?.getAttribute('cx')) || W * 914400
  const slideHeight = Number(size?.getAttribute('cy')) || H * 914400
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
    const objects = nodes(content, 'sp').map(sp => ({
      sp,
      kind: nodes(sp, 'ph')[0]?.getAttribute('type'),
      name: nodes(sp, 'cNvPr')[0]?.getAttribute('name') || '',
      text: shapeText(sp),
    }))
    const boxes = [], geometry = []
    const ownTitle=/^YanYe (cover|text|columns|image) (?:positioned )?title$/
    const declaredTitle=objects.find(s=>ownTitle.test(s.name) || ['ctrTitle','title'].includes(s.kind))
    let positionedTitle
    const shapes = objects.filter(({sp, name, text}) => {
      if (sp.parentNode?.localName !== 'spTree' || nodes(sp,'ph').length) return true
      const propsShape = nodes(sp,'spPr')[0]
      const kind = propsShape && nodes(propsShape,'prstGeom')[0]?.getAttribute('prst')
      const own=name.startsWith('YanYe ')
      const storedTitle=ownTitle.test(name) && name.includes(' positioned ')
      const explicitTextBox=['1','true'].includes(nodes(sp,'cNvSpPr')[0]?.getAttribute('txBox'))
      // Some producers encode ordinary text as a transparent, unlined rectangle with no txBox flag.
      const line=propsShape && nodes(propsShape,'ln')[0]
      const plainText=!own && !explicitTextBox && kind==='rect' && !!text.trim() && !nodes(sp,'style').length &&
        [...propsShape.children].some(el=>el.localName==='noFill') && (!line || (!line.hasAttribute('w') && !nodes(line,'solidFill').length))
      const free=name==='YanYe text box' || (!own && explicitTextBox) || plainText
      const geometric=name==='YanYe shape' || (!own && !free && Object.hasOwn(shapeKinds,kind))
      if (!storedTitle && !free && !geometric) return true
      const xf = propsShape && nodes(propsShape,'xfrm')[0], off = xf && nodes(xf,'off')[0], ext = xf && nodes(xf,'ext')[0]
      if (!off || !ext) return true
      const props = nodes(sp,'rPr')[0] || nodes(sp,'defRPr')[0] || nodes(sp,'endParaRPr')[0]
      const format = { text, x: Number(off.getAttribute('x'))/slideWidth, y: Number(off.getAttribute('y'))/slideHeight,
        w: Number(ext.getAttribute('cx'))/slideWidth, h: Number(ext.getAttribute('cy'))/slideHeight,
        fontSize: Number(props?.getAttribute('sz')) / 100 || 22,
        fontFace:props && nodes(props,'latin')[0]?.getAttribute('typeface'),
        bold:['1','true'].includes(props?.getAttribute('b')), italic:['1','true'].includes(props?.getAttribute('i')),
        align:({ctr:'center',r:'right'})[nodes(sp,'pPr')[0]?.getAttribute('algn')] || 'left',
        color:(props && nodes(props,'srgbClr')[0]?.getAttribute('val')) || slideThemes[theme].ink }
      if (storedTitle || (plainText && !declaredTitle && !positionedTitle)) {
        positionedTitle={sp,box:textBox(format)}
        return true
      }
      if (geometric) {
        const fill=[...propsShape.children].find(el=>el.localName==='solidFill'), line=nodes(propsShape,'ln')[0]
        geometry.push(slideShape({...format,kind,rotation:Number(xf.getAttribute('rot'))/60000,
          fill:fill && nodes(fill,'srgbClr')[0]?.getAttribute('val'),stroke:line && nodes(line,'srgbClr')[0]?.getAttribute('val')}))
      } else boxes.push(textBox(format))
      return false
    })
    const title = declaredTitle || shapes.find(s=>s.sp===positionedTitle?.sp) || shapes.find(s => s.text.trim())
    const layout = ownTitle.exec(title?.name || '')?.[1] || 'text'
    const rest = shapes.filter(s => s !== title && !['dt', 'ftr', 'sldNum'].includes(s.kind))
    const body = rest.find(s => s.name === 'YanYe ' + layout + ' body')
    const side = rest.find(s => s.name === 'YanYe columns side')
    const item = newSlide({ layout, title: title?.text || '', body: body ? body.text : rest.map(s => s.text).filter(Boolean).join('\n\n'), side: side?.text || '' })
    if (positionedTitle) {
      const {id,text,...format}=positionedTitle.box
      item.titleBox=format
    }
    if (boxes.length) item.textBoxes = boxes
    const transition=parseTransition(content)
    if (transition) item.transition=transition
    if (geometry.length) item.shapes = geometry
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
