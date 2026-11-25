export const LIMITS = { rows: 5000, cols: 128, sheets: 32, text: 32767 }

export function columnName(column) {
  let name = ''
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + (n - 1) % 26) + name
  }
  return name
}

export const address = (row, col) => columnName(col) + (row + 1)
const cellPattern = /^(\$?)([A-Z]{1,3})(\$?)([1-9]\d{0,6})$/i
export function location(ref) {
  const m = cellPattern.exec(ref)
  if (!m) return null
  let col = 0
  for (const c of m[2].toUpperCase()) col = col * 26 + c.charCodeAt(0) - 64
  return { row: Number(m[4]) - 1, col: col - 1, absCol: m[1], absRow: m[3] }
}

export function newSheet(name = '工作表1', id = crypto.randomUUID()) {
  return { id, name, rows: 24, cols: 8, cells: {} }
}

export function emptyWorkbook() {
  return { sheets: [newSheet('工作表1', 'sheet-1')], active: 'sheet-1' }
}

const plainNumber = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
export const isNumberText = text => plainNumber.test(text.trim()) && Number.isFinite(Number(text))
const quoteName = name => "'" + name.replaceAll("'", "''") + "'!"
const sheetKey = name => name.toLowerCase()
const qualifier = "(?:'((?:[^']|'')+)'|([\\p{L}\\p{N}_.]+))!"
const cellPart = '(\\$?[A-Z]{1,3}\\$?[1-9]\\d{0,6})'
const refSource = '(?:' + qualifier + ')?' + cellPart
const refToken = new RegExp('^(?:' + refSource + ')(?![\\p{L}\\p{N}_(])', 'iu')
const refsInFormula = new RegExp('(?<![\\p{L}\\p{N}_])' + refSource + '(?::' + cellPart + ')?(?![\\p{L}\\p{N}_(])', 'giu')
const sheetOf = (quoted, unquoted) => quoted?.replaceAll("''", "'") ?? unquoted

function mapReferences(formula, mapper) {
  if (!formula.startsWith('=')) return formula
  // Preserve quoted string literals in imported formulas outside the calculation subset.
  return formula.split(/("(?:[^"]|"")*")/).map((part, i) => i % 2 ? part :
    part.replace(refsInFormula, (all, quoted, unquoted, start, end) =>
      mapper(all, sheetOf(quoted, unquoted), start, end))).join('')
}

function mapAllCells(sheets, fn) {
  return sheets.map(sheet => {
    const cells = {}
    for (const [ref, value] of Object.entries(sheet.cells)) {
      const next = fn(sheet, ref, value)
      if (next) cells[next[0]] = next[1]
    }
    return { ...sheet, cells }
  })
}

export function renameReferences(formula, names) {
  return mapReferences(formula, (all, sheet, start, end) => {
    if (!sheet || !names.has(sheetKey(sheet))) return all
    const name = names.get(sheetKey(sheet))
    return name === null ? '#REF!' : quoteName(name) + start + (end ? ':' + end : '')
  })
}

export function validName(name, sheets, exceptId) {
  return name.trim() && name.length <= 31 && !/[\\/?*\[\]:\x00-\x1f]/.test(name) &&
    !/^'|'$/.test(name) && name.toLowerCase() !== 'history' &&
    !sheets.some(s => s.id !== exceptId && sheetKey(s.name) === sheetKey(name))
}

export function renameSheet(book, id, name) {
  const target = book.sheets.find(sheet => sheet.id === id)
  name = name.trim()
  if (!validName(name, book.sheets, id)) throw new Error('表名须唯一，最多 31 字符，且符合 Excel 工作表命名规则。')
  const names = new Map([[sheetKey(target.name), name]])
  const sheets = mapAllCells(book.sheets, (_, ref, raw) => [ref, renameReferences(raw, names)])
  return { ...book, sheets: sheets.map(sheet => sheet.id === id ? { ...sheet, name } : sheet) }
}

export function removeSheet(book, id) {
  if (book.sheets.length <= 1) throw new Error('工作簿须保留一张工作表。')
  const target = book.sheets.find(sheet => sheet.id === id)
  const names = new Map([[sheetKey(target.name), null]])
  const sheets = mapAllCells(book.sheets.filter(sheet => sheet.id !== id), (_,ref,raw) => [ref,renameReferences(raw,names)])
  return { ...book, sheets, active: book.active === id ? sheets[0].id : book.active }
}

export function fillFrom(sheet, row, col, direction) {
  const dr = direction === 'down' ? 1 : 0, dc = direction === 'right' ? 1 : 0
  if (row < dr || col < dc) return sheet
  const source = address(row-dr,col-dc), dest = address(row,col)
  function offset(ref) {
    const p = location(ref)
    const r = p.row + (p.absRow ? 0 : dr), c = p.col + (p.absCol ? 0 : dc)
    return r >= LIMITS.rows || c >= LIMITS.cols ? null : p.absCol + columnName(c) + p.absRow + (r+1)
  }
  const raw = mapReferences(sheet.cells[source] ?? '', (_,name,start,end) => {
    const first = offset(start), last = end && offset(end)
    if (!first || (end && !last)) return '#REF!'
    return (name ? quoteName(name) : '') + first + (last ? ':'+last : '')
  })
  const formats = { ...sheet.formats }
  if (formats[source]) formats[dest] = formats[source]
  else delete formats[dest]
  return { ...writeRange(sheet,row,col,[[raw]]),formats }
}

const formats = {
  number: new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}),
  currency: new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}),
  percent: new Intl.NumberFormat('zh-CN',{style:'percent',maximumFractionDigits:2}),
}
export const formatted = (value,style) => typeof value === 'number' && Object.hasOwn(formats,style) ? formats[style].format(value) : value

export function shiftGrid(book, id, axis, index, delta) {
  const target = book.sheets.find(sheet => sheet.id === id)
  const size = axis === 'row' ? 'rows' : 'cols'
  if (target[size] + delta < 1 || target[size] + delta > LIMITS[size]) throw new Error('已达到行列数量边界。')
  function moved(ref, role) {
    const point = location(ref)
    if (delta === -1 && point[axis] === index) {
      if (!role) return null
      if (role === 'upper') point[axis]--
    } else if (point[axis] >= index) point[axis] += delta
    return point[axis] < 0 ? null : point.absCol + columnName(point.col) + point.absRow + (point.row + 1)
  }
  const sheets = mapAllCells(book.sheets, (sheet, ref, raw) => {
    const nextRef = sheet.id === id ? moved(ref) : ref
    if (!nextRef) return null
    const value = mapReferences(raw, (all, name, start, end) => {
      if (sheetKey(name ?? sheet.name) !== sheetKey(target.name)) return all
      const a = location(start)[axis]
      const b = end && location(end)[axis]
      if (delta === -1 && a === index && (!end || b === index)) return '#REF!'
      const first = moved(start, end && (a <= b ? 'lower' : 'upper'))
      const last = end && moved(end, a <= b ? 'upper' : 'lower')
      if (!first || (end && !last)) return '#REF!'
      return (name ? quoteName(name) : '') + first + (last ? ':' + last : '')
    })
    return [nextRef, value]
  }).map(sheet => {
    if (sheet.id !== id) return sheet
    const shifted = { ...sheet, [size]: sheet[size] + delta }
    if (sheet.formats) {
      shifted.formats = {}
      for (const [ref,format] of Object.entries(sheet.formats)) {
        const next = moved(ref)
        if (next) shifted.formats[next] = format
      }
    }
    if (axis === 'col') {
      for (const name of ['sort','chart']) {
        const config = sheet[name]
        if (!config || config.col < index) continue
        shifted[name] = delta === -1 && config.col === index ? null : {...config,col:config.col+delta}
      }
    }
    return shifted
  })
  return { ...book, sheets }
}

function fail(code) { throw new Error(code) }

function tokenize(formula) {
  const tokens = []
  let offset = 1
  while (offset < formula.length) {
    if (/\s/.test(formula[offset])) { offset++; continue }
    const tail = formula.slice(offset)
    const ref = refToken.exec(tail)
    const number = /^(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?/i.exec(tail)
    const name = /^[a-z_][a-z\d_.]*/i.exec(tail)
    let token
    if (ref) token = { type: 'ref', sheet: sheetOf(ref[1], ref[2]), ref: ref[3], text: ref[0] }
    else if (number) token = { type: 'number', text: number[0] }
    else if (name) token = { type: 'name', text: name[0] }
    else if ('+-*/^(),:'.includes(tail[0])) token = { type: tail[0], text: tail[0] }
    else fail(tail.startsWith('#REF!') ? '#REF!' : '#VALUE!')
    tokens.push(token)
    offset += token.text.length
    if (tokens.length > 2048) fail('#LIMIT!')
  }
  return tokens
}

function numberOf(value) {
  if (typeof value === 'number') return value
  if (value === null || value === '') return 0
  return isNumberText(value) ? Number(value) : fail('#VALUE!')
}

function calculate(formula, current, getSheet, read) {
  const tokens = tokenize(formula)
  let index = 0
  const eat = type => tokens[index]?.type === type && ++index
  const need = type => { if (!eat(type)) fail('#VALUE!') }

  function primary() {
    const token = tokens[index++]
    if (!token) fail('#VALUE!')
    if (token.type === 'number') return Number(token.text)
    if (token.type === '(') { const value = sum(); need(')'); return value }
    if (token.type === 'ref') {
      const sheet = token.sheet ? getSheet(token.sheet) : current
      if (!sheet) fail('#REF!')
      return read(sheet, token.ref)
    }
    if (token.type !== 'name') fail('#VALUE!')
    need('(')
    const values = []
    if (!eat(')')) {
      do {
        if (tokens[index]?.type === 'ref' && tokens[index + 1]?.type === ':') {
          const start = tokens[index]
          const end = tokens[index + 2]
          if (end?.type !== 'ref' || end.sheet) fail('#REF!')
          index += 3
          const sheet = start.sheet ? getSheet(start.sheet) : current
          if (!sheet) fail('#REF!')
          const a = location(start.ref), b = location(end.ref)
          if (Math.max(a.row,b.row) >= LIMITS.rows || Math.max(a.col,b.col) >= LIMITS.cols) fail('#REF!')
          if ((Math.abs(a.row-b.row)+1) * (Math.abs(a.col-b.col)+1) > 50000) fail('#LIMIT!')
          for (let r = Math.min(a.row,b.row); r <= Math.max(a.row,b.row); r++) {
            for (let c = Math.min(a.col,b.col); c <= Math.max(a.col,b.col); c++) values.push(read(sheet,address(r,c)))
          }
        } else values.push(sum())
      } while (eat(','))
      need(')')
    }
    const nums = values.filter(value => typeof value === 'number')
    switch (token.text.toUpperCase()) {
      case 'SUM': return nums.reduce((a,b) => a + b, 0)
      case 'AVERAGE': return nums.length ? nums.reduce((a,b) => a + b, 0) / nums.length : fail('#DIV/0!')
      case 'COUNT': return nums.length
      case 'MIN': return nums.length ? nums.reduce((a,b) => Math.min(a,b)) : 0
      case 'MAX': return nums.length ? nums.reduce((a,b) => Math.max(a,b)) : 0
      case 'ABS': return values.length === 1 ? Math.abs(numberOf(values[0])) : fail('#VALUE!')
      case 'ROUND': {
        if (values.length !== 2) fail('#VALUE!')
        const x = numberOf(values[0]), scale = 10 ** Math.trunc(numberOf(values[1]))
        return Math.sign(x) * Math.round(Math.abs(x) * scale) / scale
      }
      default: return fail('#NAME?')
    }
  }
  function unary() {
    if (eat('-')) return -numberOf(unary())
    if (eat('+')) return numberOf(unary())
    return primary()
  }
  function power() {
    const value = unary()
    return eat('^') ? numberOf(value) ** numberOf(power()) : value
  }
  function product() {
    let value = power()
    while (['*','/'].includes(tokens[index]?.type)) {
      const op = tokens[index++].type, right = numberOf(power())
      if (op === '/' && right === 0) fail('#DIV/0!')
      value = op === '*' ? numberOf(value) * right : numberOf(value) / right
    }
    return value
  }
  function sum() {
    let value = product()
    while (['+','-'].includes(tokens[index]?.type)) {
      const op = tokens[index++].type, right = numberOf(product())
      value = op === '+' ? numberOf(value) + right : numberOf(value) - right
    }
    return value
  }
  const result = sum()
  if (index !== tokens.length) fail('#VALUE!')
  if (typeof result === 'number' && !Number.isFinite(result)) fail('#NUM!')
  return result ?? 0
}

export function evaluator(book) {
  const cache = new Map(), visiting = new Set()
  const byName = new Map(book.sheets.map(s => [sheetKey(s.name), s]))
  function read(sheet, ref) {
    const point = location(ref)
    if (!point || point.row >= LIMITS.rows || point.col >= LIMITS.cols) fail('#REF!')
    const addr = address(point.row, point.col)
    const raw = sheet.cells[addr] ?? ''
    if (!raw.startsWith('=')) {
      if (!raw) return null
      if (raw.startsWith("'")) return raw.slice(1)
      return isNumberText(raw) ? Number(raw) : raw
    }
    const key = sheet.id + ':' + addr
    if (cache.has(key)) {
      const cached = cache.get(key)
      if (cached instanceof Error) throw cached
      return cached
    }
    if (visiting.has(key)) fail('#CYCLE!')
    if (visiting.size >= 256) fail('#LIMIT!')
    visiting.add(key)
    try {
      const value = calculate(raw, sheet, name => byName.get(sheetKey(name)), read)
      cache.set(key, value)
      return value
    } catch (error) {
      cache.set(key, error)
      throw error
    } finally { visiting.delete(key) }
  }
  return (sheet, ref) => {
    try { return read(sheet, ref) ?? '' } catch (error) {
      return error.message?.startsWith('#') ? error.message : '#VALUE!'
    }
  }
}

export function parseDelimited(text, delimiter = ',', maxRows = LIMITS.rows) {
  const rows = []
  let row = [], field = '', quoted = false, closed = false
  const data = text.replace(/^\uFEFF/, '')
  function finishField() {
    if (field.length > LIMITS.text || row.length >= LIMITS.cols) throw new Error('数据超过工作表的列数或单元格长度上限。')
    row.push(field); field = ''; closed = false
  }
  function finishRow() {
    if (rows.length >= maxRows) throw new Error('数据超过 ' + maxRows + ' 行。')
    rows.push(row); row = []
  }
  for (let i = 0; i < data.length; i++) {
    const ch = data[i]
    if (quoted) {
      if (ch !== '"') field += ch
      else if (data[i + 1] === '"') { field += '"'; i++ }
      else { quoted = false; closed = true }
    } else if (ch === delimiter) finishField()
    else if (ch === '\n' || ch === '\r') {
      finishField(); finishRow()
      if (ch === '\r' && data[i+1] === '\n') i++
    } else if (ch === '"' && !field && !closed) quoted = true
    else {
      if (closed) throw new Error('引号后的内容不符合分隔文本格式。')
      field += ch
    }
  }
  if (quoted) throw new Error('引号未闭合。')
  if (row.length || field || closed || !rows.length) { finishField(); finishRow() }
  return rows
}

export function writeRange(sheet, row, col, data) {
  const rows = Math.max(sheet.rows, row + data.length)
  const cols = Math.max(sheet.cols, col + data.reduce((max,line) => Math.max(max,line.length),0))
  if (rows > LIMITS.rows || cols > LIMITS.cols) throw new Error('单表最多 5000 行、128 列。')
  const cells = { ...sheet.cells }
  data.forEach((line,r) => line.forEach((value,c) => {
    if (value.length > LIMITS.text) throw new Error('单元格最多 32767 个字符。')
    const addr = address(row+r,col+c)
    if (value) cells[addr] = value
    else delete cells[addr]
  }))
  return { ...sheet, rows, cols, cells }
}

export function delimitedText(rows, delimiter = ',') {
  return rows.map(row => row.map(cell => {
    const value = String(cell ?? '')
    return value.includes(delimiter) || /["\r\n]/.test(value)
      ? '"' + value.replaceAll('"','""') + '"' : value
  }).join(delimiter)).join('\r\n')
}

export function csvText(sheet, display) {
  const points = Object.keys(sheet.cells).map(location)
  const rowCount = points.reduce((n,p) => Math.max(n,p.row+1),1)
  const colCount = points.reduce((n,p) => Math.max(n,p.col+1),1)
  return delimitedText(Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: colCount }, (_, c) => display(sheet,address(r,c)))))
}
