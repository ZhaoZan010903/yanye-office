import { EditorState, Facet, StateEffect, StateField } from '@codemirror/state'
import { invertedEffects } from '@codemirror/commands'
import { changedLineMap } from './plain-text.js'
import { spliceTxtContent } from '../../shared/workspace-delta.mjs'

const defaultEol = Facet.define({ combine: values => values[0] })
const restoreMap = StateEffect.define()
export const lineEndings = StateField.define({
  create: () => undefined,
  update(map, tr) {
    const restored = tr.effects.findLast(effect => effect.is(restoreMap))
    if (restored) return restored.value
    if (map === undefined || !tr.docChanged) return map
    return changedLineMap(map, tr.startState.facet(defaultEol), tr)
  },
})

const rememberEndings = invertedEffects.of(tr => {
  const map = tr.startState.field(lineEndings)
  if (map === undefined || !tr.docChanged) return []
  // A normal character edit leaves the map intact. Only add undo data when
  // a group changes the original separator sequence (including undo/redo).
  const next = tr.effects.findLast(effect => effect.is(restoreMap))
  const updated = next ? next.value : changedLineMap(map, tr.startState.facet(defaultEol), tr)
  return updated === map ? [] : [restoreMap.of(map)]
})

export function txtEditorState(model, extensions) {
  return EditorState.create({ doc:model.text,
    extensions:[extensions, defaultEol.of(model.eol), lineEndings.init(() => model.lineMap), rememberEndings] })
}

export function textAfterEdit(model, update) {
  let start, end, inserted = ''
  update.changes.iterChanges((from, to, _fromB, _toB, chunk) => {
    if (start === undefined) start = from
    else inserted += model.text.slice(end, from)
    inserted += chunk.toString()
    end = to
  })
  let next
  if (start === undefined) next = { ...model }
  else {
    const original = update.startState.doc
    next = spliceTxtContent(model, { start, removed:end-start, inserted }, {
      left:original.sliceString(Math.max(0,start-1), start), removed:original.sliceString(start,end),
      right:original.sliceString(end, Math.min(end+1,original.length)),
    })
  }
  const map = update.state.field(lineEndings)
  if (map !== undefined) next.lineMap = map
  else delete next.lineMap
  return next
}
