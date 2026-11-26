import { highlights, paperDimensions, validColor, validFont, wordValue } from './word-model.js'
import { bandTypes, pageBand, pageTypes, writeBand } from './word-bands.js'
import {commentWriter} from './word-comments.js'
export { readDocx } from './word-import.js'

const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships'
const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'
const escape = v => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const tag = (key, val) => '<w:' + key + ' w:val="' + escape(val) + '"/>'
const children = n => n.content ?? []
const twips = mm => Math.round(mm * 1440 / 25.4)

function relationships(entries) {
  return xml + '<Relationships xmlns="' + pkg + '">' + entries.map(([id, type, target, external]) =>
    '<Relationship Id="' + id + '" Type="' + rel + '/' + type + '" Target="' + escape(target) + '"' + (external ? ' TargetMode="External"' : '') + '/>').join('') + '</Relationships>'
}

function styles() {
  const headings = Array.from({length: 6}, (_,i) => '<w:style w:type="paragraph" w:styleId="Heading' + (i+1) + '"><w:name w:val="heading ' + (i+1) + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/>' + tag('outlineLvl',i) + '</w:pPr><w:rPr><w:b/>' + tag('sz',[40,32,28,26,24,22][i]) + '</w:rPr></w:style>').join('')
  return xml + '<w:styles xmlns:w="' + w + '"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' + headings + '</w:styles>'
}

function numbering(lists) {
  const definitions = ['bullet','decimal'].map((type,index) => '<w:abstractNum w:abstractNumId="' + index + '"><w:multiLevelType w:val="multilevel"/>' + Array.from({length:9},(_,i) =>
    '<w:lvl w:ilvl="' + i + '">' + tag('start',1) + tag('numFmt',type) + tag('lvlText',index ? '%' + (i+1) + '.' : '•') +
    '<w:pPr><w:ind w:left="' + ((i+1)*480) + '" w:hanging="240"/></w:pPr></w:lvl>').join('') + '</w:abstractNum>').join('')
  return xml + '<w:numbering xmlns:w="' + w + '">' + definitions + lists.map(({id, ordered, level, start}) =>
    '<w:num w:numId="' + id + '">' + tag('abstractNumId',ordered ? 1 : 0) + '<w:lvlOverride w:ilvl="' + level + '">' + tag('startOverride', start) + '</w:lvlOverride></w:num>').join('') + '</w:numbering>'
}

function runProperties(marks) {
  const types = new Set(marks?.map(mark => mark.type))
  const style = marks?.find(mark => mark.type === 'wordStyle')?.attrs ?? {}
  const {font, latinFont, size, color, highlight, script} = style
  let props = ''
  const western = validFont(latinFont) ? latinFont : font
  if (validFont(font) || validFont(western)) {
    const east = validFont(font) ? ' w:eastAsia="' + escape(font) + '"' : ''
    const latin = validFont(western) ? ' w:ascii="' + escape(western) + '" w:hAnsi="' + escape(western) + '"' : ''
    props += '<w:rFonts' + latin + east + '/>'
  }
  if (types.has('bold')) props += '<w:b/><w:bCs/>'
  if (types.has('italic')) props += '<w:i/><w:iCs/>'
  if (types.has('strike')) props += '<w:strike/>'
  if (validColor(color)) props += tag('color',color.slice(1))
  if (Number(size)>0) props += tag('sz',Math.round(Number(size)*2))
  if (Object.hasOwn(highlights,highlight)) props += tag('highlight',highlight)
  if (types.has('underline')) props += tag('u','single')
  if (script === 'superscript' || script === 'subscript') props += tag('vertAlign',script)
  return props ? '<w:rPr>' + props + '</w:rPr>' : ''
}

export async function writeDocx(value) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const { doc, layout } = wordValue(value)
  const entries = [['rStyles','styles','styles.xml'],['rNumbers','numbering','numbering.xml']]
  const lists = []
  const comments=commentWriter(escape)
  let imageCount = 0
  function inline(n) {
    if (n.type === 'hardBreak') return '<w:r><w:br/></w:r>'
    if (n.type === 'image') {
      const a = n.attrs ?? {}
      const image = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/.exec(a.src ?? '')
      if (!image) throw new Error('Word 文档中的图片须为嵌入的 PNG 或 JPEG。')
      const i = ++imageCount, path = 'media/image' + i + '.' + image[1], rid = 'rImage' + i
      zip.file('word/' + path,image[2],{base64:true})
      entries.push([rid,'image',path])
      const cx = Math.round(Math.max(1, Number(a.width) || 320)*9525), cy = Math.round(Math.max(1, Number(a.height) || 180)*9525)
      const size = ' cx="' + cx + '" cy="' + cy + '"/>'
      return '<w:r><w:drawing><wp:inline><wp:extent' + size + '<wp:docPr id="' + i + '" name="Image ' + i + '" descr="' + escape(a.alt) + '"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext' + size + '</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
    }
    const parts = String(n.text ?? '').split('\t').map(s => '<w:t xml:space="preserve">' + escape(s) + '</w:t>').join('<w:tab/>')
    const run = '<w:r>' + runProperties(n.marks) + parts + '</w:r>'
    const link = n.marks?.find(m => m.type === 'link')?.attrs?.href
    if (!link || !/^(?:https?:\/\/|mailto:)/i.test(link)) return run
    const rid = 'rLink' + entries.length
    entries.push([rid,'hyperlink',link,true])
    return '<w:hyperlink r:id="' + rid + '">' + run + '</w:hyperlink>'
  }
  function paragraph(n, num) {
    const a = n.attrs ?? {}
    let props = n.type === 'heading' ? tag('pStyle','Heading' + a.level) : ''
    if (num) props += '<w:numPr>' + tag('ilvl',num.level) + tag('numId',num.id) + '</w:numPr>'
    const spacing = []
    if (Number.isFinite(a.spaceBefore)) spacing.push('w:before="' + Math.round(a.spaceBefore*20) + '"')
    if (Number.isFinite(a.spaceAfter)) spacing.push('w:after="' + Math.round(a.spaceAfter*20) + '"')
    if (a.lineSpacing) spacing.push('w:line="' + Math.round(Number(a.lineSpacing)*240) + '" w:lineRule="auto"')
    if (spacing.length) props += '<w:spacing ' + spacing.join(' ') + '/>'
    const indent = []
    if (Number.isFinite(a.leftIndent)) indent.push('w:left="' + Math.round(a.leftIndent*20) + '"')
    if (Number.isFinite(a.firstLineChars)) indent.push('w:' + (a.firstLineChars < 0 ? 'hangingChars' : 'firstLineChars') + '="' + Math.round(Math.abs(a.firstLineChars)*100) + '"')
    else if (Number.isFinite(a.firstLinePt)) indent.push('w:' + (a.firstLinePt < 0 ? 'hanging' : 'firstLine') + '="' + Math.round(Math.abs(a.firstLinePt)*20) + '"')
    if (indent.length) props += '<w:ind ' + indent.join(' ') + '/>'
    if (a.align) props += tag('jc',a.align === 'justify' ? 'both' : a.align)
    return '<w:p><w:pPr>' + props + '</w:pPr>' + comments.paragraph(children(n),inline) + '</w:p>'
  }
  function table(n) {
    const borders = ['top','left','bottom','right','insideH','insideV'].map(k=>'<w:' + k + ' w:val="single" w:sz="4" w:color="B4B3AE"/>').join('')
    const rows = children(n)
    const columns = Math.max(1, ...rows.map(r=>children(r).reduce((s,c)=>s+(Number(c.attrs?.colspan)||1),0)))
    const width = Math.round(twips(paperDimensions(layout)[0] - layout.left - layout.right)/columns)
    const pending = new Map()
    const result = rows.map(row => {
      let output = '', col = 0
      function continuations() {
        while (pending.has(col)) {
          const entry = pending.get(col)
          output += '<w:tc><w:tcPr>' + (entry.span>1 ? tag('gridSpan',entry.span) : '') + '<w:vMerge/></w:tcPr><w:p/></w:tc>'
          if (--entry.count === 0) pending.delete(col)
          col += entry.span
        }
      }
      for (const cell of children(row)) {
        continuations()
        const span = Math.max(1,Number(cell.attrs?.colspan)||1), height = Math.max(1,Number(cell.attrs?.rowspan)||1)
        if (height>1) pending.set(col,{span,count:height-1})
        const inner = children(cell)
        output += '<w:tc><w:tcPr><w:tcW w:w="' + width*span + '" w:type="dxa"/>' + (span>1 ? tag('gridSpan',span) : '') + (height>1 ? tag('vMerge','restart') : '') +
          (cell.type==='tableHeader' ? '<w:shd w:fill="EFEDEA"/>' : '') + '</w:tcPr>' + inner.map(b=>block(b)).join('') + (!inner.length || inner.at(-1).type==='table' ? '<w:p/>' : '') + '</w:tc>'
        col += span
      }
      continuations()
      return '<w:tr>' + (children(row).length && children(row).every(c=>c.type==='tableHeader') ? '<w:trPr><w:tblHeader/></w:trPr>' : '') + output + '</w:tr>'
    })
    return '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>' + borders + '</w:tblBorders></w:tblPr><w:tblGrid>' + ('<w:gridCol w:w="' + width + '"/>').repeat(columns) + '</w:tblGrid>' + result.join('') + '</w:tbl>'
  }
  function block(n, level = 0) {
    if (n.type === 'pageBreak') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
    if (n.type === 'table') return table(n)
    if (n.type === 'bulletList' || n.type === 'orderedList') {
      const num = {id:lists.length+1,level:Math.min(level,8),ordered:n.type==='orderedList',start:Number(n.attrs?.start)||1}
      lists.push(num)
      return children(n).map(item=>children(item).map((child,i)=>i===0 ? paragraph(child,num) : block(child,level+1)).join('')).join('')
    }
    return paragraph(n)
  }
  const body = children(doc).map(n=>block(n)).join('')
  const [width,height] = paperDimensions(layout)
  const parts = [['document','document.main'],['styles','styles'],['numbering','numbering']]
  if(comments.notes.length) {
    parts.push(['comments','comments'])
    entries.push(['rComments','comments','comments.xml'])
    zip.file('word/comments.xml',xml+comments.body())
  }
  let references = ''
  for (const kind of Object.keys(bandTypes)) {
    for (const [index,type] of Object.keys(pageTypes).entries()) {
      const band = pageBand(layout,type,kind)
      if (!band.text) continue
      const name = kind+(index+1), id = 'r'+name
      zip.file('word/'+name+'.xml', xml+writeBand(band,kind,escape))
      parts.push([name,kind])
      entries.push([id,kind,name+'.xml'])
      references += '<w:'+kind+'Reference w:type="'+type+'" r:id="'+id+'"/>'
    }
  }
  if (layout.differentEven) {
    parts.push(['settings','settings'])
    entries.push(['rSettings','settings','settings.xml'])
    zip.file('word/settings.xml',xml+'<w:settings xmlns:w="'+w+'"><w:evenAndOddHeaders/></w:settings>')
  }
  zip.file('word/document.xml',xml + '<w:document xmlns:w="' + w + '" xmlns:r="' + rel + '" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body + '<w:sectPr>'+references+'<w:pgSz w:w="' + twips(width) + '" w:h="' + twips(height) + '"' + (layout.landscape ? ' w:orient="landscape"' : '') + '/><w:pgMar ' + ['top','right','bottom','left'].map(side=>'w:' + side + '="' + twips(layout[side]) + '"').join(' ') + ' w:header="'+twips(layout.headerDistance??12.7)+'" w:footer="'+twips(layout.footerDistance??12.7)+'" w:gutter="0"/>'+(layout.differentFirst ? '<w:titlePg/>' : '')+'</w:sectPr></w:body></w:document>')
  zip.file('word/styles.xml',styles())
  zip.file('word/numbering.xml',numbering(lists))
  zip.file('word/_rels/document.xml.rels',relationships(entries))
  zip.file('_rels/.rels',relationships([['rDoc','officeDocument','word/document.xml']]))
  zip.file('[Content_Types].xml',xml + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' + parts.map(([p,t])=>'<Override PartName="/word/' + p + '.xml" ContentType="' + mime + t + '+xml"/>').join('') + '</Types>')
  return zip.generateAsync({type:'base64',compression:'DEFLATE'})
}
