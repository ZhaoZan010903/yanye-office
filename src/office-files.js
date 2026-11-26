export const fileTypes = Object.freeze({
  docx: { kind: 'word', label: 'Word 文档', initialName: '新建文档' },
  xlsx: { kind: 'spreadsheet', label: 'Excel 工作簿', initialName: '新建工作簿' },
  pptx: { kind: 'presentation', label: 'PowerPoint 演示文稿', initialName: '新建演示文稿' },
  md: { kind: 'note', label: 'Markdown 文档', initialName: '新建笔记' },
})

export function pageExtension(page) {
  if (!page) return null
  if (page.disk) return page.disk.extension
  if (page.kind === 'word') return 'docx'
  if (page.kind === 'spreadsheet') return 'xlsx'
  if (page.kind === 'presentation') return 'pptx'
  return ['canvas', 'database'].includes(page.kind) ? null : 'md'
}

export function fileTitle(name, extension) {
  const suffix = '.' + extension
  return name.toLowerCase().endsWith(suffix) ? name.slice(0, -suffix.length) : name
}

export async function readOfficeFile(file) {
  const { extension, content } = file
  switch (extension) {
    case 'md': return { markdown: content }
    case 'docx': {
      const { readDocx } = await import('./modules/word-docx.js')
      return { content: await readDocx(content) }
    }
    case 'xlsx': {
      const { readXlsx } = await import('./modules/spreadsheet-xlsx.js')
      const sheets = await readXlsx(content)
      return { content: { sheets, active: sheets[0].id } }
    }
    case 'pptx': {
      const { importPptx } = await import('./modules/slides-pptx.js')
      return { content: await importPptx(content) }
    }
    default: throw new Error('文件中心可编辑 DOCX、XLSX、PPTX 和 Markdown。')
  }
}

export async function writeOfficeFile(page) {
  switch (pageExtension(page)) {
    case 'md': return page.markdown
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
