export const papers = { A4: [210, 297], Letter: [215.9, 279.4] }
export const blankDoc = { type: 'doc', content: [{ type: 'paragraph' }] }
export const defaultLayout = { paper: 'A4', landscape: false, top: 25.4, bottom: 25.4, left: 25.4, right: 25.4 }

export function wordValue(value = {}) {
  const incoming = value?.layout ?? {}
  const layout = { ...defaultLayout, paper: Object.hasOwn(papers, incoming.paper) ? incoming.paper : 'A4', landscape: incoming.landscape === true }
  for (const side of ['top', 'bottom', 'left', 'right']) {
    if (Number.isFinite(incoming[side])) layout[side] = Math.max(0, Math.min(65, incoming[side]))
  }
  return { doc: value?.doc?.type === 'doc' ? value.doc : blankDoc, layout, compatibility: value?.compatibility ?? [] }
}

export function paperDimensions(layout) {
  const [width, height] = papers[layout.paper]
  return layout.landscape ? [height, width] : [width, height]
}

export function findText(doc, term) {
  const hits = []
  if (!term) return hits
  doc.descendants((block, pos) => {
    if (!block.isTextblock) return true
    let text = '', start = 0
    function scan() {
      for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + term.length)) {
        hits.push({ from: pos + 1 + start + i, to: pos + 1 + start + i + term.length })
      }
      text = ''
    }
    block.forEach((child, offset) => {
      if (child.isText) { if (!text) start = offset; text += child.text }
      else scan()
    })
    scan()
    return false
  })
  return hits
}

export function validColor(value) { return /^#[a-f0-9]{6}$/i.test(value ?? '') }
export function validFont(value) { return typeof value === 'string' && /^[\p{L}\p{N} ._-]{1,64}$/u.test(value) }
export const maxImageBytes = 4 * 1024 * 1024
