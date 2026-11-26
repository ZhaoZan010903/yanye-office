import { fieldFormat, newSlide, shapeKinds, slideBoxes, slideShape, slideThemes, textBox } from './slides-model.js'
import { readTiming, slideTargets, writeTiming } from './slide-animations.js'
import { parseTransition, transitionXml } from './slide-transition.js'

const W = 40 / 3
const H = 7.5
const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function pageBox(box) {
  return { x: box.x * W, y: box.y * H, w: box.w * W, h: box.h * H }
}

function pptText(format) {
  return { fontSize:format.fontSize, fontFace:format.fontFace, color:format.color, bold:format.bold,
    italic:format.italic, underline:format.underline ? {style:'sng'} : undefined,
    strike:format.strike ? 'sngStrike' : undefined, align:format.align, lineSpacingMultiple:format.lineSpacing }
}

// PptxGenJS writes only the point size on a paragraph mark. In WPS and
// PowerPoint this makes typing at a formatted line end revert to the theme.
// Our editor applies a single format to the whole object, including empty lines.
function formatParagraphMarks(xml) {
  return xml.replace(/<p:txBody>[\s\S]*?<\/p:txBody>/g, body=>{
    const run=body.match(/<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/)?.[0]
    if (!run) return body
    const mark=run.replace('<a:rPr','<a:endParaRPr').replace('</a:rPr>','</a:endParaRPr>')
    return body.replace(/<a:endParaRPr\b[^>]*\/>/g,()=>mark)
  })
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
    for (const field of item.layout === 'columns' ? ['title','body','side'] : ['title','body']) {
      const positioned = field === 'title' && item.titleBox
      slide.addText(item[field] || '', { ...baseText, ...pageBox(positioned || boxes[field]), ...pptText(fieldFormat(item,field,theme)),
        objectName: 'YanYe ' + item.layout + (positioned ? ' positioned ' : ' ') + field })
    }
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
        fill:{color:shape.fill}, line:{color:shape.stroke,width:1}, ...pptText(shape),
        align:shape.shapeTextAlign || 'center', valign:'middle', objectName:'YanYe shape' })
    }
    for (const box of item.textBoxes || []) {
      slide.addText(box.text, { ...baseText, ...pageBox(box), ...pptText(box),
        fit: undefined, objectName: 'YanYe text box' })
    }
  }
  const effects=deck.slides.map(item=>transitionXml(item.transition || {}))
  const hasFormatting=deck.slides.map(s=>Boolean(s.fieldFormats || s.titleBox || s.shapes?.length || s.textBoxes?.length))
  if (!effects.some(Boolean) && !hasFormatting.some(Boolean) && !deck.slides.some(s=>s.animations?.length || s.nativeTiming)) return file.write({ outputType:'base64',compression:true })
  const {default:Zip}=await import('jszip')
  const pack=await Zip.loadAsync(await file.write({ outputType:'uint8array' }))
  for (const [index,effect] of effects.entries()) {
    const item=deck.slides[index]
    const path='ppt/slides/slide'+(index+1)+'.xml'
    const hasTiming=Boolean(effect || item.animations?.length || item.nativeTiming)
    if (!hasTiming && !hasFormatting[index]) continue
    let xml=await pack.file(path).async('string')
    if (hasFormatting[index]) xml=formatParagraphMarks(xml)
    if (!hasTiming) {pack.file(path,xml); continue}
    // Read native IDs from our generated shape tree rather than assuming
    // PowerPoint numbers shapes consecutively.
    const ids=[...xml.matchAll(/<p:(?:sp|pic)>(?:(?!<\/p:(?:sp|pic)>)[\s\S])*?<p:cNvPr\s+id="(\d+)"/g)].map(match=>match[1])
    const targets=slideTargets(item)
    if (ids.length!==targets.length) throw Error('无法匹配导出演示对象的动画目标。')
    const timing=writeTiming(item,new Map(targets.map(([key],i)=>[key,ids[i]])))
    if (!xml.includes('</p:clrMapOvr>')) throw new Error('无法定位幻灯片的配色映射。')
    pack.file(path,xml.replace('</p:clrMapOvr>','</p:clrMapOvr>'+effect+timing))
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

function readTextFormat(shape) {
  const paragraph = nodes(shape,'pPr')[0]
  const props = nodes(shape,'rPr')[0] || nodes(shape,'defRPr')[0] || nodes(shape,'endParaRPr')[0]
  const format = {}
  if (props) {
    const fontFace = nodes(props,'latin')[0]?.getAttribute('typeface') || nodes(props,'ea')[0]?.getAttribute('typeface')
    if (fontFace && !fontFace.startsWith('+')) format.fontFace=fontFace
    if (props.hasAttribute('sz')) format.fontSize=Number(props.getAttribute('sz'))/100
    const color=nodes(props,'srgbClr')[0]?.getAttribute('val')
    if (color) format.color=color
    for (const [attribute,key] of [['b','bold'],['i','italic']]) {
      if (props.hasAttribute(attribute)) format[key]=['1','true'].includes(props.getAttribute(attribute))
    }
    if (props.hasAttribute('u')) format.underline=props.getAttribute('u')!=='none'
    if (props.hasAttribute('strike')) format.strike=props.getAttribute('strike')!=='noStrike'
  }
  if (paragraph) {
    const align=({l:'left',ctr:'center',r:'right',just:'justify'})[paragraph.getAttribute('algn')]
    if (align) format.align=align
    const spacing=nodes(paragraph,'lnSpc')[0]
    const pct=spacing && nodes(spacing,'spcPct')[0]
    if (pct) format.lineSpacing=Number(pct.getAttribute('val'))/100000
  }
  return format
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
    const boxes = [], geometry = [], animationTargets=new Map()
    const identify=(sp,key)=>{const id=nodes(sp,'cNvPr')[0]?.getAttribute('id'); if(id) animationTargets.set(id,key)}
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
      const format = { text, x: Number(off.getAttribute('x'))/slideWidth, y: Number(off.getAttribute('y'))/slideHeight,
        w: Number(ext.getAttribute('cx'))/slideWidth, h: Number(ext.getAttribute('cy'))/slideHeight,
        color:slideThemes[theme].ink, ...readTextFormat(sp) }
      if (storedTitle || (plainText && !declaredTitle && !positionedTitle)) {
        positionedTitle={sp,box:textBox(format)}
        return true
      }
      if (geometric) {
        const fill=[...propsShape.children].find(el=>el.localName==='solidFill'), line=nodes(propsShape,'ln')[0]
        geometry.push(slideShape({...format,kind,shapeTextAlign:format.align,rotation:Number(xf.getAttribute('rot'))/60000,
          fill:fill && nodes(fill,'srgbClr')[0]?.getAttribute('val'),stroke:line && nodes(line,'srgbClr')[0]?.getAttribute('val')}))
        identify(sp,geometry.at(-1).id)
      } else { const box=textBox(format); boxes.push(box); identify(sp,box.id) }
      return false
    })
    const title = declaredTitle || shapes.find(s=>s.sp===positionedTitle?.sp) || shapes.find(s => s.text.trim())
    const layout = ownTitle.exec(title?.name || '')?.[1] || 'text'
    const rest = shapes.filter(s => s !== title && !['dt', 'ftr', 'sldNum'].includes(s.kind))
    const body = rest.find(s => s.name === 'YanYe ' + layout + ' body')
    const side = rest.find(s => s.name === 'YanYe columns side')
    const item = newSlide({ layout, title: title?.text || '', body: body ? body.text : rest.map(s => s.text).filter(Boolean).join('\n\n'), side: side?.text || '' })
    if (title) identify(title.sp,'title')
    if (body) identify(body.sp,'body')
    else if (rest.length===1) identify(rest[0].sp,'body')
    if (side) identify(side.sp,'side')
    if (positionedTitle) {
      const {id,text,...format}=positionedTitle.box
      item.titleBox=format
    }
    for (const [field,object] of Object.entries({title,body:body || (rest.length===1?rest[0]:null),side})) {
      if (!object) continue
      const original = readTextFormat(object.sp)
      // Exporters often omit b="0" on an unbolded, non-placeholder title.
      if (field==='title' && ownTitle.test(object.name) && original.bold===undefined) original.bold=false
      const defaults = fieldFormat(item,field,slideThemes[theme])
      const overrides = Object.fromEntries(Object.entries(original).filter(([key,val])=>val!==defaults[key]))
      if (Object.keys(overrides).length) (item.fieldFormats ||= {})[field]=overrides
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
      identify(pic,'image')
      if (item.layout === 'text') item.layout = 'image'
      break
    }
    const notes = [...related.values()].find(rel => rel.type === 'notesSlide')
    if (notes) {
      const notesDoc = await xml(notes.path)
      item.notes = nodes(notesDoc, 'sp').filter(s => nodes(s, 'ph')[0]?.getAttribute('type') === 'body').map(shapeText).join('\n').trim()
    }
    Object.assign(item,readTiming(content,animationTargets))
    slides.push(item)
  }
  if (!slides.length) throw new Error('没有找到可导入的幻灯片。')
  return { theme, slides }
}
