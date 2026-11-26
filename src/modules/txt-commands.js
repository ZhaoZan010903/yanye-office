import { EditorSelection, StateEffect, StateField } from '@codemirror/state'
import { EditorView, GutterMarker, gutter } from '@codemirror/view'

const setBookmarks = StateEffect.define()
export const bookmarks = StateField.define({
  create: () => new Set(),
  update(marks, tr) {
    const change = tr.effects.findLast(effect => effect.is(setBookmarks))
    if (change) return change.value
    if (!marks.size || !tr.docChanged) return marks
    const mapped = new Set()
    for (const pos of marks) mapped.add(tr.newDoc.lineAt(tr.changes.mapPos(pos, 1)).from)
    return mapped
  },
})

export function toggleBookmark(view, pos = view.state.selection.main.head) {
  const line = view.state.doc.lineAt(pos).from
  const marks = new Set(view.state.field(bookmarks))
  if (marks.has(line)) marks.delete(line)
  else marks.add(line)
  view.dispatch({ effects:setBookmarks.of(marks) })
  return true
}

export function restoreBookmarks(view, lines) {
  const marks = new Set()
  for (const n of lines) {
    if (Number.isInteger(n) && n > 0 && n <= view.state.doc.lines) marks.add(view.state.doc.line(n).from)
  }
  view.dispatch({effects:setBookmarks.of(marks)})
}

export function jumpBookmark(view, direction) {
  const marks = [...view.state.field(bookmarks)].sort((a,b) => a-b)
  if (!marks.length) return false
  const here = view.state.doc.lineAt(view.state.selection.main.head).from
  const pos = direction > 0 ? (marks.find(p => p > here) ?? marks[0]) : (marks.findLast(p => p < here) ?? marks.at(-1))
  view.dispatch({ selection:EditorSelection.cursor(pos), effects:EditorView.scrollIntoView(pos, {y:'center'}) })
  return true
}

const flag = new class extends GutterMarker {
  toDOM() {
    const mark = document.createElement('span')
    mark.className = 'txt-bookmark'
    mark.setAttribute('aria-label', '已加书签')
    return mark
  }
}()

export const bookmarkGutter = gutter({
  class:'txt-bookmark-gutter',
  lineMarker: (view, line) => view.state.field(bookmarks).has(line.from) ? flag : null,
  lineMarkerChange: update => update.startState.field(bookmarks) !== update.state.field(bookmarks),
  domEventHandlers:{ mousedown: (view, line) => toggleBookmark(view, line.from) },
})

export function editLines(view, operation) {
  const { doc, selection } = view.state
  const { from, to, empty } = selection.main
  if (operation === 'upper' || operation === 'lower') {
    if (empty) return false
    const selected = doc.sliceString(from, to)
    const insert = operation === 'upper' ? selected.toUpperCase() : selected.toLowerCase()
    view.dispatch({changes:{from,to,insert}, selection:{anchor:from,head:from+insert.length}, userEvent:'input.case'})
    return true
  }
  // A selection ending at the start of the next line does not include that line.
  const first = empty ? 1 : doc.lineAt(from).number
  const last = empty ? doc.lines : doc.lineAt(Math.max(from, to - 1)).number
  const begin = doc.line(first).from, end = doc.line(last).to
  let rows = doc.sliceString(begin, end).split('\n')
  const finalNewline = empty && rows.at(-1) === ''
  if (finalNewline) rows.pop()
  if (operation === 'sort' || operation === 'reverseSort') {
    const compare = new Intl.Collator('zh-CN', { numeric:true }).compare
    rows.sort(operation === 'sort' ? compare : (a,b) => compare(b,a))
  } else if (operation === 'unique') rows = [...new Set(rows)]
  else if (operation === 'trim') {
    for (let i=0; i<rows.length; i++) rows[i] = rows[i].trimEnd()
  } else return false
  if (finalNewline) rows.push('')
  const insert = rows.join('\n')
  view.dispatch({changes:{from:begin,to:end,insert}, selection:empty ? {anchor:Math.min(from,begin+insert.length)} :
    {anchor:begin,head:begin+insert.length}, userEvent:'input.lines'})
  return true
}
