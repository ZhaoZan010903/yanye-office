import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { invertedEffects } from '@codemirror/commands'
import { changedLineMap } from './plain-text.js'
import { spliceTxtContent } from '../../shared/workspace-delta.mjs'

export const setFileFormat = StateEffect.define()
export const fileFormat = StateField.define({
  create: () => ({ encoding:'utf-8', bom:false, eol:'w' }),
  update(value, tr) { return tr.effects.findLast(effect => effect.is(setFileFormat))?.value ?? value },
})
const restoreMap = StateEffect.define()
export const lineEndings = StateField.define({
  create: () => undefined,
  update(map, tr) {
    const restored = tr.effects.findLast(effect => effect.is(restoreMap))
    if (restored) return restored.value
    if (map === undefined || !tr.docChanged) return map
    return changedLineMap(map, tr.startState.field(fileFormat).eol, tr)
  },
})

const rememberEndings = invertedEffects.of(tr => {
  const map = tr.startState.field(lineEndings)
  if (tr.effects.some(effect => effect.is(setFileFormat))) {
    return [setFileFormat.of(tr.startState.field(fileFormat)), restoreMap.of(map)]
  }
  if (map === undefined || !tr.docChanged) return []
  // A normal character edit leaves the map intact. Only add undo data when
  // a group changes the original separator sequence (including undo/redo).
  const next = tr.effects.findLast(effect => effect.is(restoreMap))
  const updated = next ? next.value : changedLineMap(map, tr.startState.field(fileFormat).eol, tr)
  return updated === map ? [] : [restoreMap.of(map)]
})

export function txtEditorState(model, extensions) {
  return EditorState.create({ doc:model.text,
    extensions:[extensions, fileFormat.init(() => ({ encoding:model.encoding, bom:model.bom, eol:model.eol })),
      lineEndings.init(() => model.lineMap), rememberEndings] })
}

export function convertFileFormat(view, fields) {
  const current = view.state.field(fileFormat)
  const effects = [setFileFormat.of({ ...current, ...fields })]
  if (fields.eol) effects.push(restoreMap.of(undefined))
  view.dispatch({ effects, userEvent:'input.format' })
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
  Object.assign(next, update.state.field(fileFormat))
  if (map !== undefined) next.lineMap = map
  else delete next.lineMap
  return next
}
