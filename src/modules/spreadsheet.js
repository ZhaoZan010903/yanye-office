import {conditionalAggregate,ifError,vlookup} from './sheet-lookup.js'

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

export function bounds(a, b = a) {
  return { top: Math.min(a.row,b.row), bottom: Math.max(a.row,b.row), left: Math.min(a.col,b.col), right: Math.max(a.col,b.col) }
}

export const inRect = (box,row,col) => box.top <= row && row <= box.bottom && box.left <= col && col <= box.right
export const intersects = (a,b) => a.top <= b.bottom && b.top <= a.bottom && a.left <= b.right && b.left <= a.right
export const findMerge = (sheet,row,col) => sheet.merges?.find(box => inRect(box,row,col))
export const rangeName = box => {
  const first = address(box.top,box.left), last = address(box.bottom,box.right)
  return first === last ? first : first + ':' + last
}

export function parseRange(ref) {
  if (typeof ref !== 'string') return null
  const [first,last=first,...extra]=ref.split(':')
  const a=location(first), b=location(last)
  return !extra.length && a && b && a.row<1048576 && b.row<1048576 && a.col<16384 && b.col<16384 ? bounds(a,b) : null
}

export function validationAt(sheet,row,col) {
  return sheet.validations?.find(rule=>inRect(rule.box,row,col))
}

export function outsideRange(box,cut) {
  if (!intersects(box,cut)) return [box]
  const top=Math.max(box.top,cut.top), bottom=Math.min(box.bottom,cut.bottom)
  return [
    {...box,bottom:top-1}, {...box,top:bottom+1},
    {...box,top,bottom,right:cut.left-1},{...box,top,bottom,left:cut.right+1},
  ].filter(b=>b.top<=b.bottom && b.left<=b.right)
}

export function replaceValidation(sheet,box,replacement) {
  const validations=(sheet.validations??[]).flatMap(rule=>outsideRange(rule.box,box).map(b=>({...rule,box:b})))
  if(replacement) validations.push(replacement)
  return {...sheet,validations}
}

export function clearConditions(sheet,box) {
  const conditions=(sheet.conditions??[]).flatMap(group=>{
    const ref=group.ref.split(/\s+/).map(parseRange).filter(Boolean).flatMap(b=>outsideRange(b,box)).map(rangeName).join(' ')
    return ref?[{...group,ref}]:[]
  })
  return {...sheet,conditions}
}

export function listChoices(rule) {
  const formula=rule?.formulae?.[0]
  return rule?.attrs?.type==='list' && typeof formula==='string' && /^"[^"]*"$/.test(formula)
    ? formula.slice(1,-1).split(',') : null
}

export function makeList(box,text) {
  const choices=[...new Set(text.split(/[,，\n]/).map(value=>value.trim()).filter(Boolean))]
  const formula='"'+choices.join(',')+'"'
  if (!choices.length || formula.length>257 || choices.some(value=>value.includes('"'))) throw new Error('请填写以逗号分隔的选项，合计最多 255 字符，不含双引号。')
  return {box,attrs:{type:'list',allowBlank:'1',showErrorMessage:'1',errorStyle:'stop',error:'请选择列表中的值。'},formulae:[formula]}
}

export const comparisons={
  greaterThan:['大于',(a,b)=>a>b], lessThan:['小于',(a,b)=>a<b],
  equal:['等于',(a,b)=>a===b], notEqual:['不等于',(a,b)=>a!==b],
  greaterThanOrEqual:['大于或等于',(a,b)=>a>=b], lessThanOrEqual:['小于或等于',(a,b)=>a<=b],
  between:['介于',(a,b,c)=>a>=b && a<=c], notBetween:['不介于',(a,b,c)=>a<b || a>c],
}

export function conditionRules(sheet) {
  return (sheet.conditions??[]).flatMap(group=>group.rules.filter(rule=>rule.type==='cellIs' && Object.hasOwn(comparisons,rule.operator)).map(rule=>({
    boxes:group.ref.split(/\s+/).map(parseRange).filter(Boolean),rule,
  }))).sort((a,b)=>(a.rule.priority??Infinity)-(b.rule.priority??Infinity))
}

export function conditionalFill(rules,row,col,value) {
  if (typeof value!=='number' || !Number.isFinite(value)) return
  for (const {boxes,rule} of rules) {
    if (!boxes.some(box=>inRect(box,row,col)) || !rule.formulae?.length || !rule.formulae.every(f=>isNumberText(String(f)))) continue
    const matched=comparisons[rule.operator][1](value,...rule.formulae.map(Number))
    if (matched) {
      const fill=rule.style?.fill, color=fill?.bgColor?.argb ?? fill?.fgColor?.argb
      if (/^(?:[A-F\d]{2})?[A-F\d]{6}$/i.test(color??'')) return '#'+color.slice(-6)
      if (rule.stopIfTrue) return
    }
  }
}

export function filterRow(sheet,row,display) {
  const filter=sheet.autoFilter
  if (!filter || row<=filter.box.top || row>filter.box.bottom) return true
  return Object.entries(filter.columns??{}).every(([offset,values])=>{
    const value=String(display(sheet,address(row,filter.box.left+Number(offset))))
    return values.some(item=>String(item).toLocaleLowerCase()===value.toLocaleLowerCase())
  })
}

export function mergeRange(sheet, box) {
  if (box.top === box.bottom && box.left === box.right) throw new Error('请先选择至少两个单元格。')
  if (sheet.merges?.some(other => intersects(other,box))) throw new Error('选区中已有合并单元格，请先取消合并。')
  for (const ref of Object.keys(sheet.cells)) {
    const {row,col} = location(ref)
    if (inRect(box,row,col) && (row !== box.top || col !== box.left)) {
      throw new Error('左上角以外的单元格含有数据。请先移出这些内容，再合并。')
    }
  }
  return {...sheet, merges:[...(sheet.merges ?? []),box]}
}

export function unmergeRange(sheet, box) {
  return {...sheet, merges:(sheet.merges ?? []).filter(other => !intersects(other,box))}
}

export function changeCellStyle(sheet, rows, left, right, patch) {
  const styles = { ...sheet.styles }, formats = { ...sheet.formats }
  for (const row of rows) for (let col=left; col<=right; col++) {
    const ref = address(row,col), style = { ...styles[ref] }
    for (const [key,value] of Object.entries(patch)) {
      if (key === 'numberFormat') {
        if (value) formats[ref] = value
        else delete formats[ref]
      } else if (value) style[key] = value
      else delete style[key]
    }
    if (Object.keys(style).length) styles[ref] = style
    else delete styles[ref]
  }
  return { ...sheet, styles, formats }
}

export function changeBorders(sheet, rows, left, right, mode) {
  const styles={...sheet.styles}
  for (const row of rows) for (let col=left; col<=right; col++) {
    const ref=address(row,col), style={...styles[ref]}, borders={...style.borders}
    if (mode==='none') delete style.borders
    else {
      for (const [side,edge] of [['top',row===rows[0]],['bottom',row===rows.at(-1)],['left',col===left],['right',col===right]]) {
        if (mode==='all' || edge) borders[side]={style:'thin',color:{argb:'FF37352F'}}
      }
      if (Object.keys(borders).length) style.borders=borders
    }
    if (Object.keys(style).length) styles[ref]=style
    else delete styles[ref]
  }
  return {...sheet,styles}
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
  if (book.sheets.some(s=>s.pivot?.sourceId===id)) throw new Error('此工作表是透视表的数据源。请先删除对应透视表。')
  if (book.sheets.length <= 1) throw new Error('工作簿须保留一张工作表。')
  const target = book.sheets.find(sheet => sheet.id === id)
  const names = new Map([[sheetKey(target.name), null]])
  const sheets = mapAllCells(book.sheets.filter(sheet => sheet.id !== id), (_,ref,raw) => [ref,renameReferences(raw,names)])
  return { ...book, sheets, active: book.active === id ? sheets[0].id : book.active }
}

function translateFormula(raw, dr, dc) {
  function offset(ref) {
    const p = location(ref)
    const r = p.row + (p.absRow ? 0 : dr), c = p.col + (p.absCol ? 0 : dc)
    return r < 0 || c < 0 || r >= LIMITS.rows || c >= LIMITS.cols ? null : p.absCol + columnName(c) + p.absRow + (r+1)
  }
  return mapReferences(raw, (_,name,start,end) => {
    const first = offset(start), last = end && offset(end)
    if (!first || (end && !last)) return '#REF!'
    return (name ? quoteName(name) : '') + first + (last ? ':'+last : '')
  })
}

export function copyRange(sheet, rows, left, right) {
  return rows.map(row => Array.from({length:right-left+1},(_,i) => {
    const col=left+i, ref=address(row,col)
    return {row,col,raw:sheet.cells[ref] ?? '',style:sheet.styles?.[ref],format:sheet.formats?.[ref]}
  }))
}

export function pasteRange(sheet, row, col, clipboard) {
  const formats = {...sheet.formats}, styles = {...sheet.styles}
  const matrix = clipboard.map((line,i) => line.map((cell,j) => {
    const ref = address(row+i,col+j)
    if (cell.format) formats[ref]=cell.format
    else delete formats[ref]
    if (cell.style) styles[ref]=cell.style
    else delete styles[ref]
    return translateFormula(cell.raw,row+i-cell.row,col+j-cell.col)
  }))
  return {...writeRange(sheet,row,col,matrix),formats,styles}
}

export function fillFrom(sheet, row, col, direction) {
  const dr = direction === 'down' ? 1 : 0, dc = direction === 'right' ? 1 : 0
  if (row < dr || col < dc) return sheet
  return pasteRange(sheet,row,col,copyRange(sheet,[row-dr],col-dc,col-dc))
}

export const numberFormats = {
  number:['两位小数','0.00'], integer:['整数','0'], grouped:['千分位整数','#,##0'], groupedDecimal:['千分位小数','#,##0.00'],
  currency:['人民币','"¥"#,##0.00'], percent:['百分比','0.00%'], percentWhole:['整数百分比','0%'], scientific:['科学记数','0.00E+00'],
}
const formats = {
  number: new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false}),
  integer: new Intl.NumberFormat('zh-CN',{maximumFractionDigits:0,useGrouping:false}),
  grouped: new Intl.NumberFormat('zh-CN',{maximumFractionDigits:0}),
  groupedDecimal: new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}),
  currency: new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}),
  percent: new Intl.NumberFormat('zh-CN',{style:'percent',minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false}),
  percentWhole: new Intl.NumberFormat('zh-CN',{style:'percent',maximumFractionDigits:0,useGrouping:false}),
}
export function formatted(value,style) {
  if (typeof value==='boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value!=='number') return value
  if (style==='scientific') {
    const [mantissa,exponent]=value.toExponential(2).split('e')
    return mantissa+'E'+exponent[0]+exponent.slice(1).padStart(2,'0')
  }
  return Object.hasOwn(formats,style) ? formats[style].format(value) : value
}

export function shiftGrid(book, id, axis, index, delta) {
  if (book.sheets.some(s=>s.pivot && (s.id===id || s.pivot.sourceId===id))) throw new Error('请先调整或移除对应透视表，再插入或删除整行整列。')
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
    for (const field of ['formats','styles']) {
      if (!sheet[field]) continue
      shifted[field] = {}
      for (const [ref,format] of Object.entries(sheet[field])) {
        const next = moved(ref)
        if (next) shifted[field][next] = format
      }
    }
    function shiftBox(box) {
      const start=axis==='row'?'top':'left', end=axis==='row'?'bottom':'right'
      if (delta===-1 && box[start]===index && box[end]===index) return null
      const next={...box}
      if (box[start]>index || (delta===1 && box[start]===index)) next[start]+=delta
      if (box[end]>=index) next[end]=Math.min(axis==='row'?1048575:16383,box[end]+delta)
      return next
    }
    if (sheet.merges) shifted.merges=sheet.merges.map(shiftBox).filter(box=>box && (box.top!==box.bottom || box.left!==box.right))
    if (sheet.validations) shifted.validations=sheet.validations.flatMap(rule=>{
      const box=shiftBox(rule.box)
      return box?[{...rule,box}]:[]
    })
    if (sheet.conditions) shifted.conditions=sheet.conditions.flatMap(group=>{
      const ref=group.ref.split(/\s+/).map(parseRange).filter(Boolean).map(shiftBox).filter(Boolean).map(rangeName).join(' ')
      return ref?[{...group,ref}]:[]
    })
    if (sheet.autoFilter) {
      const old=sheet.autoFilter, box=shiftBox(old.box), columns={}
      if (box) for (const [offset,values] of Object.entries(old.columns??{})) {
        const absolute=old.box.left+Number(offset)
        if (axis==='col' && delta===-1 && absolute===index) continue
        columns[absolute+(axis==='col' && absolute>=index?delta:0)-box.left]=values
      }
      shifted.autoFilter=box?{box,columns}:null
    }
    if (axis === 'row' && sheet.heights) {
      shifted.heights = {}
      for (const [key,height] of Object.entries(sheet.heights)) {
        const row=Number(key)
        if (delta===-1 && row===index) continue
        shifted.heights[row>=index ? row+delta : row]=height
      }
    }
    if (axis === 'col') {
      if (sheet.widths) {
        shifted.widths = {}
        for (const [key,width] of Object.entries(sheet.widths)) {
          const column=Number(key)
          if (delta===-1 && column===index) continue
          shifted.widths[column>=index ? column+delta : column]=width
        }
      }
      for (const name of ['sort','chart']) {
        const config = sheet[name]
        if (!config || config.col < index) continue
        shifted[name] = delta === -1 && config.col === index ? null : {...config,col:config.col+delta}
      }
    }
    if (sheet.chart?.series) {
      const chart={...sheet.chart}
      if(axis==='col') {
        const series=[], colors=[]
        for(const [i,c] of chart.series.entries()) {
          if(delta===-1 && c===index) continue
          series.push(c>=index?c+delta:c)
          if(chart.colors) colors.push(chart.colors[i])
        }
        chart.series=series; chart.col=series[0]
        if(chart.colors) chart.colors=colors
        const removedLabel=delta===-1 && chart.labelCol===index
        if(chart.labelCol>=index) chart.labelCol+=delta
        shifted.chart=removedLabel || !series.length ? null : chart
      } else if(chart.start!=null && chart.end!=null) {
        const box=shiftBox({top:chart.start,bottom:chart.end,left:0,right:0})
        if(box) {chart.start=box.top;chart.end=box.bottom; if(chart.header>=index) chart.header=Math.max(0,chart.header+delta)}
        shifted.chart=box?chart:null
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
    const literal = /^"(?:[^"]|"")*"/.exec(tail)
    const comparison = /^(?:<>|<=|>=|[<>=])/.exec(tail)
    const error=/^#(?:N\/A|VALUE!|REF!|DIV\/0!|NAME\?|NUM!|NULL!)/i.exec(tail)
    let token
    if (error) token={type:'error',text:error[0]}
    else if (ref) token = { type: 'ref', sheet: sheetOf(ref[1], ref[2]), ref: ref[3], text: ref[0] }
    else if (number) token = { type: 'number', text: number[0] }
    else if (name) token = { type: 'name', text: name[0] }
    else if (literal) token = { type: 'string', text: literal[0] }
    else if (comparison) token = { type:'comparison', text:comparison[0] }
    else if ('+-*/^(),:&'.includes(tail[0])) token = { type: tail[0], text: tail[0] }
    else fail(tail.startsWith('#REF!') ? '#REF!' : '#VALUE!')
    tokens.push(token)
    offset += token.text.length
    if (tokens.length > 2048) fail('#LIMIT!')
  }
  return tokens
}

function numberOf(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return Number(value)
  if (Array.isArray(value)) fail('#VALUE!')
  if (value === null || value === '') return 0
  return isNumberText(value) ? Number(value) : fail('#VALUE!')
}

function compare(left, right, op) {
  if (left == null) left = typeof right === 'string' ? '' : 0
  if (right == null) right = typeof left === 'string' ? '' : 0
  if (typeof left === 'string') left = left.toLowerCase()
  if (typeof right === 'string') right = right.toLowerCase()
  const rank = value => typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : 2
  const difference = rank(left)-rank(right) || (left < right ? -1 : left > right ? 1 : 0)
  return { '=':difference===0, '<>':difference!==0, '<':difference<0, '>':difference>0, '<=':difference<=0, '>=':difference>=0 }[op]
}

function criterionMatches(criterion) {
  const match = /^(<>|<=|>=|[<>=])?([\s\S]*)$/.exec(String(criterion ?? ''))
  const op = match[1] || '=', literal = match[2]
  const expected = isNumberText(literal) ? Number(literal) : literal
  if (typeof expected === 'number') return value => {
    if (typeof value === 'number' || value === null) return compare(value,expected,op)
    return op === '<>'
  }
  if ((op === '=' || op === '<>') && /[~?*]/.test(literal)) {
    const pattern = []
    const chars = Array.from(literal.toLowerCase())
    for (let i=0; i<chars.length; i++) {
      if (chars[i] === '~' && ['?','*','~'].includes(chars[i+1])) pattern.push({literal:chars[++i]})
      else if (chars[i] === '*') pattern.push({star:true})
      else if (chars[i] === '?') pattern.push({any:true})
      else pattern.push({literal:chars[i]})
    }
    return value => {
      if (typeof value !== 'string') return op === '<>'
      const input = Array.from(value.toLowerCase())
      let i=0, p=0, star=-1, consumed=0
      while (i < input.length) {
        if (pattern[p]?.any || pattern[p]?.literal === input[i]) { i++; p++; continue }
        if (pattern[p]?.star) { star=p++; consumed=i; continue }
        if (star === -1) return op === '<>'
        p=star+1; i=++consumed
      }
      while (pattern[p]?.star) p++
      return op === '=' ? p === pattern.length : p !== pattern.length
    }
  }
  return value => compare(value,expected,op)
}

function calculate(formula, current, getSheet, read) {
  const tokens = tokenize(formula)
  let index = 0
  const eat = type => tokens[index]?.type === type && ++index
  const need = type => { if (!eat(type)) fail('#VALUE!') }
  const target = token => (token.sheet ? getSheet(token.sheet) : current) || fail('#REF!')
  const scalar = value => Array.isArray(value) ? fail('#VALUE!') : value
  const truth = value => typeof value === 'string' ? fail('#VALUE!') : Boolean(scalar(value))

  function primary() {
    const token = tokens[index++]
    if (!token) fail('#VALUE!')
    if (token.type === 'number') return () => Number(token.text)
    if (token.type === 'error') return ()=>fail(token.text.toUpperCase())
    if (token.type === 'string') return () => token.text.slice(1,-1).replaceAll('""','"')
    if (token.type === '(') { const value = expression(); need(')'); return value }
    if (token.type === 'ref') {
      const range=!!eat(':')
      const end=range?tokens[index++]:token
      if(end?.type!=='ref' || (range && end.sheet)) fail('#REF!')
      const box=bounds(location(token.ref),location(end.ref))
      const area=()=>{
        if (box.bottom >= LIMITS.rows || box.right >= LIMITS.cols) fail('#REF!')
        if ((box.bottom-box.top+1)*(box.right-box.left+1) > 50000) fail('#LIMIT!')
        const sheet=target(token)
        return {rows:box.bottom-box.top+1,cols:box.right-box.left+1,at:(r,c)=>read(sheet,address(box.top+r,box.left+c))}
      }
      const result=()=>{
        if(!range) return read(target(token),token.ref)
        const data=area(),values=[]
        for(let r=0;r<data.rows;r++) for(let c=0;c<data.cols;c++) values.push(data.at(r,c))
        return values
      }
      result.area=area
      return result
    }
    if (token.type !== 'name') fail('#VALUE!')
    const name = token.text.toUpperCase()
    if (['TRUE','FALSE'].includes(name) && tokens[index]?.type !== '(') return () => name === 'TRUE'
    need('(')
    const args = []
    if (!eat(')')) {
      do { args.push(expression()) } while (eat(','))
      need(')')
    }
    const valid = (min,max=min) => { if (args.length < min || args.length > max) fail('#VALUE!') }
    return () => {
      if(name==='IFERROR') return ifError(args)
      if(name==='VLOOKUP') return vlookup(args,numberOf,compare,criterionMatches)
      if(name==='SUMIFS' || name==='COUNTIFS') return conditionalAggregate(name,args,criterionMatches)
      if (name === 'IF') {
        valid(2,3)
        return truth(args[0]()) ? scalar(args[1]()) : args[2] ? scalar(args[2]()) : false
      }
      if (name === 'COUNTIF' || name === 'SUMIF') {
        valid(2,name === 'SUMIF' ? 3 : 2)
        const samples = [args[0]()].flat(), matches = criterionMatches(scalar(args[1]()))
        const amounts = args[2] ? [args[2]()].flat() : samples
        if (samples.length !== amounts.length) fail('#VALUE!')
        return samples.reduce((total,v,i) => matches(v) ? total + (name === 'COUNTIF' ? 1 : typeof amounts[i] === 'number' ? amounts[i] : 0) : total,0)
      }
      if (name === 'ABS') { valid(1); return Math.abs(numberOf(args[0]())) }
      if (name === 'ROUND') {
        valid(2)
        const x = numberOf(args[0]()), scale = 10 ** Math.trunc(numberOf(args[1]()))
        return Math.sign(x) * Math.round(Math.abs(x) * scale) / scale
      }
      const values = args.flatMap(arg => [arg()].flat())
      const nums = values.filter(value => typeof value === 'number')
      switch (name) {
        case 'SUM': return nums.reduce((a,b) => a+b,0)
        case 'AVERAGE': return nums.length ? nums.reduce((a,b) => a+b,0)/nums.length : fail('#DIV/0!')
        case 'COUNT': return nums.length
        case 'COUNTA': return values.filter(v => v !== null).length
        case 'MIN': return nums.length ? nums.reduce((a,b) => Math.min(a,b)) : 0
        case 'MAX': return nums.length ? nums.reduce((a,b) => Math.max(a,b)) : 0
        default: return fail('#NAME?')
      }
    }
  }

  function unary() {
    if (eat('-')) { const val = unary(); return () => -numberOf(val()) }
    if (eat('+')) { const val = unary(); return () => numberOf(val()) }
    return primary()
  }
  function power() {
    const left = unary()
    if (!eat('^')) return left
    const right = power()
    return () => numberOf(left()) ** numberOf(right())
  }
  function series(term, operators, apply) {
    const first = term(), rest = []
    while (operators.includes(tokens[index]?.type)) rest.push([tokens[index++].text,term()])
    return rest.length ? () => rest.reduce((left,[op,right]) => apply(left,op,right()),first()) : first
  }
  function product() {
    return series(power,['*','/'],(a,op,b) => {
      const x=numberOf(a), y=numberOf(b)
      if (op === '/' && !y) fail('#DIV/0!')
      return op === '*' ? x*y : x/y
    })
  }
  const sum = () => series(product,['+','-'],(a,op,b) => op === '+' ? numberOf(a)+numberOf(b) : numberOf(a)-numberOf(b))
  const concat = () => series(sum,['&'],(a,op,b) => String(scalar(a) ?? '')+String(scalar(b) ?? ''))
  const expression = () => series(concat,['comparison'],(a,op,b) => compare(scalar(a),scalar(b),op))
  const evaluate = expression()
  if (index !== tokens.length) fail('#VALUE!')
  const result = scalar(evaluate())
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
    const validation=validationAt(sheet,row+r,col+c), choices=listChoices(validation)
    if (value && choices && ['1','true'].includes(validation.attrs.showErrorMessage) && (validation.attrs.errorStyle??'stop')==='stop'
        && !choices.some(choice=>choice.toLocaleLowerCase()===value.replace(/^'/,'').toLocaleLowerCase())) {
      throw new Error(addr+' 的值须从下拉列表中选择。')
    }
    const merge = findMerge(sheet,row+r,col+c)
    if (merge && (row+r !== merge.top || col+c !== merge.left) && value) throw new Error('粘贴区域包含已合并单元格，请先取消合并。')
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
