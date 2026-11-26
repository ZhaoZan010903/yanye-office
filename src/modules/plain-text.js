const endings = { n: '\n', w: '\r\n', r: '\r' }
const marks = { 'utf-8': [239,187,191], 'utf-16le': [255,254], 'utf-16be': [254,255] }
export const encodingNames = { 'utf-8':'UTF-8', 'utf-16le':'UTF-16 LE', 'utf-16be':'UTF-16 BE', gb18030:'GB18030', gbk:'GBK' }
export const legacyChinese = encoding => encoding === 'gb18030' || encoding === 'gbk'
export const eolNames = { n:'LF', w:'CRLF', r:'CR' }
export const blankText = { text:'', encoding:'utf-8', bom:false, eol:'w' }

export function base64Bytes(value) {
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(value)
  return Uint8Array.from(atob(value), c => c.charCodeAt(0))
}

export function base64(bytes) {
  if (bytes.toBase64) return bytes.toBase64()
  let result = ''
  for (let i = 0; i < bytes.length; i += 16_384) result += String.fromCharCode(...bytes.subarray(i, i + 16_384))
  return btoa(result)
}

export function detectEncoding(bytes) {
  for (const [encoding, mark] of Object.entries(marks)) {
    if (mark.every((byte, i) => bytes[i] === byte)) return encoding
  }
  if (bytes.subarray(0, 1024).includes(0)) return null
  try {
    new TextDecoder('utf-8', { fatal:true }).decode(bytes)
    return 'utf-8'
  } catch { return null }
}

export function decodeText(bytes, encoding) {
  const decoded = new TextDecoder(encoding, { fatal:true, ignoreBOM:false }).decode(bytes)
  const mark = marks[encoding]
  const bom = Boolean(mark && mark.every((byte,i) => bytes[i] === byte))
  return textModel(decoded, encoding, bom)
}

export function textModel(decoded, encoding, bom) {
  if (!decoded.includes('\r')) return { text:decoded, encoding, bom, eol:decoded.includes('\n') ? 'n' : 'w' }
  const counts = { n:0, w:0, r:0 }
  const codes = []
  const text = decoded.replace(/\r\n|\r|\n/g, line => {
    const code = line === '\r\n' ? 'w' : line === '\r' ? 'r' : 'n'
    counts[code]++
    codes.push(code)
    return '\n'
  })
  const types = Object.keys(counts).filter(code => counts[code] > 0).sort((a,b) => counts[b] - counts[a])
  return { text, encoding, bom, eol:types[0] || 'w', ...(types.length > 1 ? { lineMap:codes.join('') } : {}) }
}

export function restoreLineEndings(value) {
  let line = 0
  return value.text.replace(/\n/g, () => endings[value.lineMap?.[line++] || value.eol])
}

export function encodeText(input) {
  const value = { ...blankText, ...input }
  const raw = restoreLineEndings(value)
  const encoding = value.encoding
  if (!Object.hasOwn(marks, encoding)) throw new Error('请选择支持的 Unicode 保存编码。')
  if (encoding === 'utf-8' && !raw.isWellFormed()) throw new Error('正文含不成对的 UTF-16 代理项。请修正对应字符，或选择 UTF-16 LE / BE 保存。')
  const mark = value.bom ? marks[encoding] : []
  let bytes
  if (encoding === 'utf-8') {
    const text = new TextEncoder().encode(raw)
    if (!mark.length) return base64(text)
    bytes = new Uint8Array(mark.length + text.length)
    bytes.set(text, mark.length)
  } else {
    bytes = new Uint8Array(mark.length + raw.length * 2)
    const view = new DataView(bytes.buffer)
    for (let i=0; i<raw.length; i++) view.setUint16(mark.length + i*2, raw.charCodeAt(i), encoding === 'utf-16le')
  }
  bytes.set(mark)
  return base64(bytes)
}

export function changedLineMap(lineMap, eol, update) {
  let map = '', cursor = 0
  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const first = update.startState.doc.lineAt(fromA).number - 1
    const last = update.startState.doc.lineAt(toA).number - 1
    if (last - first === inserted.lines - 1) return
    const reuse = Math.min(last-first, inserted.lines-1)
    map += lineMap.slice(cursor, first + reuse) + eol.repeat(inserted.lines - 1 - reuse)
    cursor = last
  })
  return cursor === 0 && map === '' ? lineMap : map + lineMap.slice(cursor)
}
