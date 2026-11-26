export const pageTypes = { default:'默认页', first:'首页', even:'偶数页' }
export const bandTypes = { header:'页眉', footer:'页脚' }
export const bandFields = { '{{PAGE}}':'PAGE', '{{NUMPAGES}}':'NUMPAGES' }
const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const tokenPattern = /(\{\{(?:PAGE|NUMPAGES)\}\})/g

export function pageBand(layout, type, kind) {
  const band = layout.bands?.[type]?.[kind]
  return { text:typeof band?.text === 'string' ? band.text : '', align:['left','center','right'].includes(band?.align) ? band.align : 'center' }
}

function recognizedField(instruction) {
  return /^\s*(PAGE|NUMPAGES)(?:\s+\\\*\s+MERGEFORMAT)?\s*$/i.exec(instruction)?.[1]?.toUpperCase()
}

// Word and WPS can split an instruction and its cached result across many runs.
export function readBand(element, warn) {
  const paragraphs = [...element.getElementsByTagNameNS(wordNamespace,'p')]
  if (element.getElementsByTagNameNS(wordNamespace,'drawing').length || element.getElementsByTagNameNS(wordNamespace,'tbl').length) {
    warn('页眉页脚中的图片或表格会简化为文本')
  }
  if (element.getElementsByTagNameNS(wordNamespace,'rPr').length) warn('页眉页脚中的局部字体样式简化为统一样式')
  let align = 'left'
  const lines = paragraphs.map((paragraph,index) => {
    const paragraphAlign = paragraph.getElementsByTagNameNS(wordNamespace,'jc')[0]?.getAttributeNS(wordNamespace,'val')
    if (!index && ['left','center','right'].includes(paragraphAlign)) align = paragraphAlign
    if (index && paragraphAlign && paragraphAlign!==align) warn('同一页眉页脚的段落共用首段对齐方式')
    const stack = []
    let text = ''
    const add = value => {
      if (!stack.length) text += value
      else if (stack.at(-1).result) stack.at(-1).cached += value
    }
    function visit(el) {
      if (el.namespaceURI === wordNamespace) {
        if (el.localName === 'fldSimple') {
          const field = recognizedField(el.getAttributeNS(wordNamespace,'instr'))
          if (field) { add('{{'+field+'}}'); return }
          warn('页眉页脚中未支持的域保留显示文字')
        } else if (el.localName === 'fldChar') {
          const type = el.getAttributeNS(wordNamespace,'fldCharType')
          if (type === 'begin') stack.push({ instruction:'', cached:'', result:false })
          else if (type === 'separate' && stack.length) stack.at(-1).result = true
          else if (type === 'end' && stack.length) {
            const item = stack.pop(), field = recognizedField(item.instruction)
            if (!field) warn('页眉页脚中未支持的域保留显示文字')
            add(field ? '{{'+field+'}}' : item.cached)
          }
          return
        } else if (el.localName === 'instrText') {
          if (stack.length) stack.at(-1).instruction += el.textContent
          return
        } else if (el.localName === 't') { add(el.textContent); return }
        else if (el.localName === 'tab') { add('\t'); return }
        else if (el.localName === 'br') { add('\n'); return }
        else if (el.localName === 'del') return
      }
      for (const child of el.children) visit(child)
    }
    visit(paragraph)
    return text
  })
  return {text:lines.join('\n'), align}
}

export function writeBand(band, kind, escape) {
  const root = kind === 'header' ? 'hdr' : 'ftr'
  const body = band.text.split('\n').map(line => {
    const runs = line.split(tokenPattern).filter(Boolean).map(part => {
      if (Object.hasOwn(bandFields,part)) {
        return '<w:fldSimple w:instr=" '+bandFields[part]+' "><w:r><w:t>1</w:t></w:r></w:fldSimple>'
      }
      return '<w:r>'+part.split('\t').map(t=>'<w:t xml:space="preserve">'+escape(t)+'</w:t>').join('<w:tab/>')+'</w:r>'
    }).join('')
    return '<w:p><w:pPr><w:jc w:val="'+band.align+'"/></w:pPr>'+runs+'</w:p>'
  }).join('')
  return '<w:'+root+' xmlns:w="'+wordNamespace+'">'+body+'</w:'+root+'>'
}

function printContent(text) {
  return text.split(tokenPattern).filter(Boolean).map(part => {
    if (bandFields[part]) return 'counter('+(bandFields[part]==='PAGE'?'page':'pages')+')'
    return '"'+part.replace(/[\x00-\x1f"\\]/g, c=>'\\'+c.charCodeAt(0).toString(16)+' ')+'"'
  }).join(' ') || 'none'
}

export function bandPrintStyles(layout) {
  const types = ['default', ...(layout.differentEven ? ['even'] : []), ...(layout.differentFirst ? ['first'] : [])]
  return types.map(type => {
    const boxes = Object.keys(bandTypes).flatMap(kind => {
      const band = pageBand(layout,type,kind)
      return ['left','center','right'].map(side => '@'+(kind==='header'?'top':'bottom')+'-'+side+'{content:'+
        (side===band.align ? printContent(band.text) : 'none')+';font:10pt "Microsoft YaHei",sans-serif;white-space:pre-line;}')
    }).join('')
    return '@page'+({default:'',even:':left',first:':first'}[type])+'{'+boxes+'}'
  }).join('')
}
