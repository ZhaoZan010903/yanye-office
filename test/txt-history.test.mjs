import assert from 'node:assert/strict'
import test from 'node:test'
import { history, redo, undo } from '@codemirror/commands'
import { decodeText, encodeText } from '../src/modules/plain-text.js'
import { textAfterEdit, txtEditorState } from '../src/modules/txt-history.js'
import { addPage, initialWorkspace, makePage, updatePage, workspaceBytes } from '../shared/workspace.mjs'
import { applyWorkspaceDelta, workspaceDelta } from '../shared/workspace-delta.mjs'

test('CodeMirror undo restores original bytes for minority and grouped mixed TXT line endings', () => {
  const original = Buffer.from('\ufeffa\r\nb\nc\rd\r\ne', 'utf16le')
  let model = decodeText(original, 'utf-16le')
  let state = txtEditorState(model, history())
  const dispatch = tr => {
    state = tr.state
    model = textAfterEdit(model, tr)
  }
  const bytes = () => Buffer.from(encodeText(model), 'base64')
  dispatch(state.update({ changes:{from:3,to:4}, userEvent:'delete.backward' }))
  assert.equal(model.lineMap, 'wrw')
  assert.ok(undo({state, dispatch}))
  assert.deepEqual(bytes(), original)
  assert.ok(redo({state, dispatch}))
  assert.equal(model.lineMap, 'wrw')
  assert.ok(undo({state, dispatch}))
  // Delete adjacent ranges in the same undo group, including both minority separators.
  dispatch(state.update({ changes:{from:5,to:6}, userEvent:'delete.backward' }))
  dispatch(state.update({ changes:{from:3,to:5}, userEvent:'delete.backward' }))
  const edited = bytes()
  assert.equal(model.lineMap, 'ww')
  assert.ok(undo({state, dispatch}))
  assert.deepEqual(bytes(), original)
  assert.ok(redo({state, dispatch}))
  assert.deepEqual(bytes(), edited)
})

test('exact editor splices keep the UTF-8 quota and replay equivalent for multi-range and surrogate changes', () => {
  let content=decodeText(Buffer.from('a😀\r\n题\n末'),'utf-8'), state=txtEditorState(content, [])
  let ws=addPage(initialWorkspace(),{...makePage({id:'mixed',kind:'txt'}),content})
  for (const changes of [
    [{from:2,to:3,insert:'\ud802'},{from:4,to:5,insert:'\n"'}],
    [{from:1,to:2,insert:'\n'},{from:5,to:5,insert:'\udffe'}],
  ]) {
    const tx=state.update({changes})
    content=textAfterEdit(content,tx)
    state=tx.state
    assert.equal(content.text,state.doc.toString())
    assert.equal(workspaceBytes(ws),Buffer.byteLength(JSON.stringify(ws)))
    const next={...updatePage(ws,'mixed',{content}),revision:ws.revision+1}
    const delta=workspaceDelta(ws,next)
    assert.equal(workspaceBytes(next),Buffer.byteLength(JSON.stringify(next)))
    assert.deepEqual(applyWorkspaceDelta(ws,structuredClone(delta)),next)
    ws=next
  }
})
