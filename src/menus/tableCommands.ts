import type { Editor } from '@tiptap/core'
import { TableMap, selectedRect, moveTableRow, moveTableColumn } from '@tiptap/pm/tables'
import { Fragment } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

export function focusCell(editor: Editor, cell: Element) {
  if (!editor.view.dom.contains(cell)) return false
  const pos = editor.view.posAtDOM(cell, 0)
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos))))
  return true
}

export function alignColumn(editor: Editor, align: string) {
  const rect = selectedRect(editor.state)
  const tr = editor.state.tr
  const cells = rect.map.cellsInRect({ left: rect.left, right: rect.left + 1, top: 0, bottom: rect.map.height })
  for (const offset of cells) {
    const pos = rect.tableStart + offset
    const node = tr.doc.nodeAt(pos)!
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, align })
  }
  editor.view.dispatch(tr)
  editor.view.focus()
}

export function moveInTable(editor: Editor, axis: 'row' | 'column', step: number) {
  const rect = selectedRect(editor.state)
  const row = axis === 'row'
  const from = row ? rect.top : rect.left
  const to = from + step
  if (to < (row ? 1 : 0) || (row && from === 0) || to >= (row ? rect.map.height : rect.map.width)) return false
  const move = row ? moveTableRow : moveTableColumn
  return move({from,to,select:false})(editor.state,editor.view.dispatch)
}

export function tableSize(editor: Editor) {
  const rect = selectedRect(editor.state)
  return { rows: rect.map.height, columns: rect.map.width }
}

export function resizeTable(editor: Editor, rows: number, columns: number) {
  const {table, tableStart} = selectedRect(editor.state)
  const map = TableMap.get(table)
  const schema = editor.schema
  const nextRows = []
  for (let r = 0; r < rows; r++) {
    const cells = []
    for (let c = 0; c < columns; c++) {
      const old = r < map.height && c < map.width ? table.nodeAt(map.map[r * map.width + c]) : null
      const type = r === 0 ? schema.nodes.tableHeader : schema.nodes.tableCell
      cells.push(old || type.createAndFill()!)
    }
    nextRows.push(schema.nodes.tableRow.create(null, cells))
  }
  const replacement = table.copy(Fragment.fromArray(nextRows))
  const tr = editor.state.tr.replaceWith(tableStart - 1, tableStart + table.nodeSize - 1, replacement)
  tr.setSelection(TextSelection.near(tr.doc.resolve(tableStart + 1)))
  editor.view.dispatch(tr)
  editor.view.focus()
}
