const lineBreaks = /\r\n|[\r\n]/g
export const editorSource = raw => raw.replace(/\r\n?/g, '\n')

export function rawSourceOffset(raw, offset) {
  let index=0, display=0
  while (index < raw.length && display < offset) {
    if (raw[index] === '\r' && raw[index+1] === '\n') index++
    index++; display++
  }
  return index
}

// Textareas normalize CR and CRLF. Preserve untouched ranges in the original file.
export function editSource(raw, next) {
  if (!raw.includes('\r')) return next
  const old=editorSource(raw)
  let first=0, tail=0
  while (first<old.length && first<next.length && old[first]===next[first]) first++
  while (tail<old.length-first && tail<next.length-first && old[old.length-1-tail]===next[next.length-1-tail]) tail++
  const a=rawSourceOffset(raw,first), b=rawSourceOffset(raw,old.length-tail)
  const separators = raw.slice(a,b).match(lineBreaks) ?? []
  const fallback = /\r\n|[\r\n]/.exec(raw)?.[0] ?? '\n'
  let i=0
  return raw.slice(0,a) + next.slice(first,next.length-tail).replace(/\n/g,()=>separators[i++] ?? fallback) + raw.slice(b)
}

export function markdownMatches(value, query, caseSensitive) {
  if (!query) return []
  const pattern = new RegExp(RegExp.escape(query), caseSensitive?'gu':'giu')
  const matches = []
  function scan(text, offset) {
    for (const hit of text.matchAll(pattern)) {
      matches.push({ from:offset+hit.index, to:offset+hit.index+hit[0].length })
      if (matches.length>10000) return
    }
  }
  if (typeof value === 'string') scan(value,0)
  else value?.descendants((node,pos) => {
    if (!node.isTextblock || matches.length>10000) return matches.length<=10000
    let run='', start=pos+1
    node.forEach((item,offset) => {
      if (matches.length>10000) return
      if (item.isText) {
        if (!run) start=pos+1+offset
        run+=item.text
      } else {
        if (run) scan(run,start)
        run=''
      }
    })
    if (run && matches.length<=10000) scan(run,start)
    return false
  })
  return matches
}
