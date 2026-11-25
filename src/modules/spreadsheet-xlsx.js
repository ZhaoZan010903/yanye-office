import { address, evaluator, isNumberText, LIMITS, newSheet, renameReferences, validName } from './spreadsheet.js'

export const exchangeNote = 'XLSX 支持值、公式及基础数值格式。日期转为文本，图片、图表、宏和复杂版式不参与转换。CSV 导出当前表的计算结果。'
const numberFormats = { number:'0.00', currency:'"¥"#,##0.00', percent:'0.00%' }

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
    ws.eachRow((row,r) => row.eachCell((cell,c) => {
      const value = cell.value
      if (value === null || value === undefined || (cell.isMerged && cell.master.address !== cell.address)) return
      let raw
      if (typeof value === 'string') raw = plainText(value)
      else if (typeof value === 'number' || typeof value === 'boolean') raw = String(value)
      else if (cell.formula) raw = '=' + cell.formula
      else if (value instanceof Date) raw = value.toISOString().replace(/T00:00:00\.000Z$/, '')
      else raw = plainText(cell.text ?? '')
      if (raw.length > LIMITS.text) throw new Error('单元格超过 32767 字符。')
      const ref = address(r-1,c-1)
      if (raw) sheet.cells[ref] = raw
      const format = String(cell.numFmt ?? '')
      let style
      if (/%/.test(format)) style = 'percent'
      else if (/[¥￥]/.test(format)) style = 'currency'
      else if (format === '0.00' || format === '#,##0.00') style = 'number'
      if (style) (sheet.formats ??= {})[ref] = style
    }))
    return sheet
  })
}

export async function writeXlsx(book) {
  const workbook = await excelWorkbook()
  workbook.calcProperties.fullCalcOnLoad = true
  const display = evaluator(book)
  for (const sheet of book.sheets) {
    const ws = workbook.addWorksheet(sheet.name)
    for (const [ref,raw] of Object.entries(sheet.cells)) {
      const cell = ws.getCell(ref)
      if (raw.startsWith('=')) {
        const result = display(sheet,ref)
        cell.value = { formula: raw.slice(1), ...(typeof result === 'number' ? { result } : {}) }
      } else cell.value = raw.startsWith("'") ? raw.slice(1) : isNumberText(raw) ? Number(raw) : raw
    }
    for (const [ref,style] of Object.entries(sheet.formats ?? {})) {
      if (Object.hasOwn(numberFormats,style)) ws.getCell(ref).numFmt = numberFormats[style]
    }
  }
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())
  const parts = []
  for (let i=0; i<bytes.length; i+=16384) parts.push(String.fromCharCode(...bytes.subarray(i,i+16384)))
  return btoa(parts.join(''))
}
