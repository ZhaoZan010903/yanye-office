import { bounds, evaluator, isNumberText, LIMITS, location, newSheet, numberFormats, rangeName, renameReferences, validName } from './spreadsheet.js'

export const exchangeNote = 'XLSX 保留值、公式、常用数字格式、字体字号、加粗、斜体、下划线、删除线、RGB 字色和填充、边框、水平与垂直对齐、合并区域、行高列宽及首行首列冻结。日期转为文本。图片、图表、宏与复杂样式超出当前转换范围。CSV 导出当前表的计算结果。'
const formatByCode = new Map(Object.entries(numberFormats).map(([key,[,code]])=>[code,key]))

export function availableName(proposed, sheets) {
  let base = proposed.replace(/[\\/?*\[\]:\x00-\x1f]/g,' ').trim().replace(/^'+|'+$/g,'').slice(0,31) || '工作表'
  if (base.toLowerCase() === 'history') base += ' 表'
  let candidate = base, n = 1
  while (!validName(candidate,sheets)) {
    const suffix = ' (' + (++n) + ')'
    candidate = base.slice(0,31-suffix.length).replace(/'+$/,'') + suffix
  }
  return candidate
}

export function appendSheets(book, imported) {
  if (book.sheets.length + imported.length > LIMITS.sheets) throw new Error('每个工作簿最多支持 32 张工作表。')
  const names = new Map()
  const reserved = [...book.sheets]
  const sheets = imported.map(sheet => {
    const name = availableName(sheet.name, reserved)
    names.set(sheet.name.toLowerCase(),name)
    reserved.push({ name })
    return { ...sheet, name }
  }).map(sheet => ({ ...sheet, cells: Object.fromEntries(Object.entries(sheet.cells).map(([ref,raw]) =>
    [ref,renameReferences(raw,names)])) }))
  return { ...book, sheets: [...book.sheets, ...sheets], active: sheets[0].id }
}

export function verifyArchive(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  for (; end >= Math.max(0, bytes.length-65557); end--) {
    if (view.getUint32(end,true) === 0x06054b50) break
  }
  if (end < Math.max(0,bytes.length-65557)) throw new Error('XLSX 压缩包损坏或已加密。')
  const entries = view.getUint16(end+10,true)
  let offset = view.getUint32(end+16,true), total = 0
  if (entries > 4096) throw new Error('工作簿包含过多资源。')
  for (let i=0; i<entries; i++) {
    if (offset + 46 > end || view.getUint32(offset,true) !== 0x02014b50) throw new Error('XLSX 压缩包目录无效。')
    total += view.getUint32(offset+24,true)
    if (total > 64*1024*1024) throw new Error('工作簿解压后超过 64 MiB。')
    offset += 46 + view.getUint16(offset+28,true) + view.getUint16(offset+30,true) + view.getUint16(offset+32,true)
  }
}

async function excelWorkbook() {
  const { default: ExcelJS } = await import('exceljs')
  return new ExcelJS.Workbook()
}

const plainText = value => value.startsWith('=') || value.startsWith("'") || isNumberText(value) ? "'" + value : value
const rgb = color => /^[a-f\d]{8}$/i.test(color?.argb ?? '') ? '#' + color.argb.slice(2).toUpperCase() : undefined
const argb = color => 'FF' + color.slice(1).toUpperCase()

export async function readXlsx(base64) {
  if (base64.length > Math.ceil(32 * 1024 * 1024 / 3) * 4) throw new Error('XLSX 文件超过 32 MiB 导入上限。')
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  verifyArchive(bytes)
  const workbook = await excelWorkbook()
  await workbook.xlsx.load(bytes, { ignoreNodes: ['drawing','picture','conditionalFormatting','dataValidations'] })
  if (!workbook.worksheets.length || workbook.worksheets.length > LIMITS.sheets) throw new Error('XLSX 须含 1 到 32 张工作表。')
  return workbook.worksheets.map(ws => {
    if (ws.rowCount > LIMITS.rows || ws.columnCount > LIMITS.cols) throw new Error('单表最多 5000 行、128 列。')
    const sheet = newSheet(ws.name)
    sheet.rows = Math.max(sheet.rows,ws.rowCount)
    sheet.cols = Math.max(sheet.cols,ws.columnCount)
    const frozen = ws.views?.find(v => v.state === 'frozen')
    if (frozen?.xSplit === 1) sheet.freezeColumn = true
    if (frozen?.ySplit === 1) sheet.freezeHeader = true
    const worksheetModel = ws.model
    for (const column of worksheetModel.cols ?? []) {
      if (!(column.width > 0) || column.min > LIMITS.cols) continue
      sheet.cols=Math.max(sheet.cols,Math.min(column.max,LIMITS.cols))
      for (let num=column.min; num<=Math.min(column.max,LIMITS.cols); num++) {
        (sheet.widths ??= {})[num-1]=Math.min(255,column.width)
      }
    }
    sheet.merges = (worksheetModel.merges ?? []).map(range => {
      const [a,b] = range.split(':').map(location)
      if (!a || !b || b.row >= LIMITS.rows || b.col >= LIMITS.cols) throw new Error('合并区域超出支持的行列数。')
      return bounds(a,b)
    })
    for (const row of worksheetModel.rows) {
      if (row.height > 0) {
        if (row.number > LIMITS.rows) throw new Error('单表最多 5000 行。')
        sheet.rows=Math.max(sheet.rows,row.number)
        sheet.heights ??= {}
        sheet.heights[row.number-1]=row.height
      }
    }
    for (const row of worksheetModel.rows) for (const model of row.cells) {
      const ref = model.address, pos = location(ref)
      if (!pos || pos.col >= LIMITS.cols || pos.row >= LIMITS.rows) throw new Error('单表最多 5000 行、128 列。')
      const cell = ws.getCell(ref)
      sheet.rows = Math.max(sheet.rows,pos.row+1)
      sheet.cols = Math.max(sheet.cols,pos.col+1)
      if (cell.isMerged && cell.master.address !== ref) continue
      const style = {}
      if (cell.font?.bold) style.bold = true
      if (cell.font?.italic) style.italic = true
      if (cell.font?.underline) style.underline = cell.font.underline === true ? 'single' : cell.font.underline
      if (cell.font?.strike) style.strike = true
      if (cell.font?.name) style.font = cell.font.name
      if (cell.font?.size) style.size = cell.font.size
      if (rgb(cell.font?.color)) style.color = rgb(cell.font.color)
      if (cell.fill?.pattern === 'solid' && rgb(cell.fill.fgColor)) style.fill = rgb(cell.fill.fgColor)
      if (['left','center','right'].includes(cell.alignment?.horizontal)) style.align = cell.alignment.horizontal
      if (['top','middle','bottom'].includes(cell.alignment?.vertical)) style.vertical = cell.alignment.vertical
      if (cell.border && Object.values(cell.border).some(side=>side?.style)) style.borders = cell.border
      if (Object.keys(style).length) (sheet.styles ??= {})[ref] = style
      const format = String(cell.numFmt ?? '')
      let numFmt = formatByCode.get(format)
      if (!numFmt && /%/.test(format)) numFmt = 'percent'
      else if (!numFmt && /[¥￥]/.test(format)) numFmt = 'currency'
      if (numFmt) (sheet.formats ??= {})[ref] = numFmt
      const value = cell.value
      if (value === null || value === undefined) continue
      let raw
      if (typeof value === 'string') raw = plainText(value)
      else if (typeof value === 'number' || typeof value === 'boolean') raw = String(value)
      else if (cell.formula) raw = '=' + cell.formula
      else if (value instanceof Date) raw = value.toISOString().replace(/T00:00:00\.000Z$/, '')
      else raw = plainText(cell.text ?? '')
      if (raw.length > LIMITS.text) throw new Error('单元格超过 32767 字符。')
      if (raw) sheet.cells[ref] = raw
    }
    return sheet
  })
}

export async function writeXlsx(book) {
  const workbook = await excelWorkbook()
  workbook.calcProperties.fullCalcOnLoad = true
  const display = evaluator(book)
  for (const sheet of book.sheets) {
    const ws = workbook.addWorksheet(sheet.name)
    for (const [index,height] of Object.entries(sheet.heights ?? {})) ws.getRow(Number(index)+1).height=height
    for (const [index,width] of Object.entries(sheet.widths ?? {})) ws.getColumn(Number(index)+1).width=width
    if (sheet.freezeColumn || sheet.freezeHeader) ws.views = [{state:'frozen', xSplit:sheet.freezeColumn ? 1 : 0, ySplit:sheet.freezeHeader ? 1 : 0}]
    for (const box of sheet.merges ?? []) ws.mergeCells(rangeName(box))
    for (const [ref,raw] of Object.entries(sheet.cells)) {
      const cell = ws.getCell(ref)
      if (raw.startsWith('=')) {
        const result = display(sheet,ref)
        const cached = typeof result === 'string' && result.startsWith('#') ? {} : {result}
        cell.value = { formula: raw.slice(1), ...cached }
      } else cell.value = raw.startsWith("'") ? raw.slice(1) : isNumberText(raw) ? Number(raw) : raw
    }
    for (const [ref,style] of Object.entries(sheet.formats ?? {})) {
      if (Object.hasOwn(numberFormats,style)) ws.getCell(ref).numFmt = numberFormats[style][1]
    }
    for (const [ref,style] of Object.entries(sheet.styles ?? {})) {
      const cell = ws.getCell(ref)
      if (cell.isMerged && cell.master.address !== ref) continue
      if (style.bold || style.italic || style.underline || style.strike || style.color || style.font || style.size) cell.font = {
        bold: Boolean(style.bold), italic: Boolean(style.italic),
        ...(style.underline ? {underline:style.underline} : {}),
        ...(style.strike ? {strike:true} : {}),
        ...(style.color ? { color: { argb:argb(style.color) } } : {}),
        ...(style.font ? {name:style.font} : {}),
        ...(style.size ? {size:style.size} : {}),
      }
      if (style.fill) cell.fill = {type:'pattern',pattern:'solid',fgColor:{argb:argb(style.fill)}}
      if (style.align || style.vertical) cell.alignment = {...(style.align ? {horizontal:style.align} : {}),...(style.vertical ? {vertical:style.vertical} : {})}
      if (style.borders) cell.border = style.borders
    }
  }
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())
  const parts = []
  for (let i=0; i<bytes.length; i+=16384) parts.push(String.fromCharCode(...bytes.subarray(i,i+16384)))
  return btoa(parts.join(''))
}
