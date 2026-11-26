import { base64, base64Bytes, decodeText, detectEncoding, encodeText, legacyChinese, textModel } from './modules/plain-text.js'

export const fileTypes = Object.freeze({
  docx: { kind: 'word', label: 'Word 文档', initialName: '新建文档' },
  xlsx: { kind: 'spreadsheet', label: 'Excel 工作簿', initialName: '新建工作簿' },
  xlsm: { kind:'spreadsheet', label:'启用宏的工作簿', initialName:'工作簿', openOnly:true },
  pptx: { kind: 'presentation', label: 'PowerPoint 演示文稿', initialName: '新建演示文稿' },
  md: { kind: 'note', label: 'Markdown 文档', initialName: '新建笔记' },
  txt: { kind:'txt', label:'纯文本', initialName:'新建文本' },
  pdf: { kind:'pdf', label:'PDF 阅读器', openOnly:true },
})

export function pageExtension(page) {
  if (!page) return null
  if (page.disk) return page.disk.extension
  if (page.content?.preserved?.base) return page.content.preserved.base.extension
  if (page.kind === 'word') return 'docx'
  if (page.kind === 'txt') return 'txt'
  if (page.kind === 'pdf') return null
  if (page.kind === 'spreadsheet') return 'xlsx'
  if (page.kind === 'presentation') return 'pptx'
  return ['canvas', 'database'].includes(page.kind) ? null : 'md'
}

export function fileTitle(name, extension) {
  const suffix = '.' + extension
  return name.toLowerCase().endsWith(suffix) ? name.slice(0, -suffix.length) : name
}

export async function readOfficeFile(file, chooseEncoding) {
  const { extension, content } = file
  switch (extension) {
    case 'md': return { markdown: content }
    case 'pdf': return { content:{} }
    case 'txt': {
      if (file.textEncoding === 'utf-8') {
        const bom = content.charCodeAt(0) === 0xfeff
        return { content:textModel(bom ? content.slice(1) : content,'utf-8',bom) }
      }
      const bytes = base64Bytes(content)
      const encoding = detectEncoding(bytes) || await chooseEncoding(bytes, file.name)
      if (!encoding) return null
      let model
      try { model=decodeText(bytes,encoding) }
      catch { throw new Error('文件中有无法按所选编码读取的字节，请重新打开并选择编码。') }
      if (legacyChinese(encoding)) {
        const {hasOriginalMapping}=await import('./modules/legacy-text.js')
        if (!await hasOriginalMapping(model,bytes)) model.noncanonicalEncoding=encoding
      }
      return {content:model}
    }
    case 'docx': {
      const { readDocx } = await import('./modules/word-docx.js')
      return { content: await readDocx(content) }
    }
    case 'xlsx':
    case 'xlsm': {
      const { readXlsx } = await import('./modules/spreadsheet-xlsx.js')
      const sheets = await readXlsx(content)
      const book={sheets, active:sheets[0].id}
      if(extension==='xlsm' || sheets.some(s=>s.advancedPivot)) {
        const {preservedMetadata}=await import('./modules/preserved-workbook.js')
        book.preserved=await preservedMetadata(base64Bytes(content))
      }
      return {content:book}
    }
    case 'pptx': {
      const { importPptx } = await import('./modules/slides-pptx.js')
      return { content: await importPptx(content) }
    }
    default: throw new Error('此类型尚未提供编辑器。')
  }
}

export async function writeOfficeFile(page, readOriginal) {
  if(page.content?.preserved || page.disk?.extension==='xlsm') {
    const base=page.content?.preserved?.base || page.disk
    if(!base || !readOriginal) throw Error('需要按原件修订读取此工作簿，才能保留 VBA 和工作簿对象。')
    const bytes=await readOriginal(base.id,base.revision)
    const {patchWorkbook}=await import('./modules/preserved-workbook.js')
    return base64(await patchWorkbook(bytes,page.content.preserved?.edits || {}))
  }
  switch (pageExtension(page)) {
    case 'md': return page.markdown
    case 'txt': {
      if (legacyChinese(page.content?.encoding)) {
        const {legacyBytes}=await import('./modules/legacy-text.js')
        return base64(await legacyBytes(page.content))
      }
      return encodeText(page.content)
    }
    case 'docx': {
      const { writeDocx } = await import('./modules/word-docx.js')
      return writeDocx(page.content)
    }
    case 'xlsx': {
      const { writeXlsx } = await import('./modules/spreadsheet-xlsx.js')
      const { emptyWorkbook } = await import('./modules/spreadsheet.js')
      return writeXlsx(page.content.sheets?.length ? page.content : emptyWorkbook())
    }
    case 'pptx': {
      const { exportPptx } = await import('./modules/slides-pptx.js')
      const { readDeck } = await import('./modules/slides-model.js')
      return exportPptx(readDeck(page.content), page.title)
    }
    default: throw new Error('请通过此模块的文件菜单导出。')
  }
}
