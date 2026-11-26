import assert from 'node:assert/strict'
import test from 'node:test'
import { history, redo, undo } from '@tiptap/pm/history'
import { Fragment, Schema, Slice } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { resolveRevisions, revisions, WordRevision } from '../src/modules/word-revisions.js'

const schema=new Schema({
  nodes:{
    doc:{content:'block+'}, paragraph:{group:'block', content:'inline*'},
    sectionBreak:{group:'block',atom:true}, image:{group:'inline',inline:true,atom:true},
    text:{group:'inline'},
  },
  marks:{wordRevision:{attrs:{id:{},kind:{},date:{},author:{}}}, bold:{}},
})
const paragraph=text=>schema.node('paragraph',null,typeof text==='string'?schema.text(text):text)
function fixture(blocks=[paragraph('ABC'),paragraph('DEF')]) {
  const messages=[], settings={enabled:true,author:'甲'}
  const plugins=WordRevision.config.addProseMirrorPlugins.call({options:{
    settings:()=>settings,report:message=>messages.push(message),
  }})
  let state=EditorState.create({schema,doc:schema.node('doc',null,blocks),plugins:[history(),...plugins]})
  function dispatch(tr) { state=state.applyTransaction(tr).state }
  return {get state(){return state},view:{dispatch},dispatch,messages,settings}
}

test('跨段删除、跨段替换及多段粘贴完整保留原文和原有撤销记录',()=>{
  const editor=fixture(),before=editor.state.doc
  editor.dispatch(editor.state.tr.delete(2,7))
  editor.dispatch(editor.state.tr.insertText('替换',2,7))
  const paste=new Slice(Fragment.fromArray([paragraph('一'),paragraph('二')]),1,1)
  editor.dispatch(editor.state.tr.replace(2,2,paste))
  assert.equal(editor.state.doc,before)
  assert.deepEqual(revisions(before),[])
  assert.equal(editor.messages.length,3)
  assert.equal(undo(editor.state,editor.dispatch),false)
  editor.settings.enabled=false
  editor.dispatch(editor.state.tr.delete(2,7))
  assert.equal(editor.state.doc.toString(),'doc(paragraph("AEF"))')
})

test('一个事务含不支持的结构编辑时，所有步骤一同取消',()=>{
  const editor=fixture([paragraph('甲'),schema.node('sectionBreak'),paragraph('乙')])
  const before=editor.state.doc
  const tr=editor.state.tr.insertText('一',2)
  tr.delete(4,5)
  editor.dispatch(tr)
  assert.equal(editor.state.doc,before)
  assert.match(editor.messages[0],/跟踪修订/)
  const inline=fixture([paragraph([schema.text('A'),schema.node('image'),schema.text('B')])])
  const withImage=inline.state.doc
  inline.dispatch(inline.state.tr.delete(2,3))
  assert.equal(inline.state.doc,withImage)
})

test('段内替换支持撤销、重做及拒绝全部',()=>{
  const editor=fixture(), before=editor.state.doc
  editor.dispatch(editor.state.tr.insertText('新',2,3))
  assert.deepEqual(revisions(editor.state.doc).map(x=>[x.kind,x.text]),[['del','B'],['ins','新']])
  assert.equal(undo(editor.state,editor.dispatch),true)
  assert.ok(editor.state.doc.eq(before))
  assert.equal(redo(editor.state,editor.dispatch),true)
  resolveRevisions(editor,revisions(editor.state.doc),false)
  assert.ok(editor.state.doc.eq(before))
  assert.deepEqual(editor.messages,[])
})

test('输入法更新同一段内自己的候选文字只留下最终插入',()=>{
  const editor=fixture([paragraph('好')])
  editor.dispatch(editor.state.tr.insertText('ni',1).setMeta('composition',1))
  editor.dispatch(editor.state.tr.insertText('你',1,3).setMeta('composition',1))
  assert.equal(editor.state.doc.textContent,'你好')
  assert.deepEqual(revisions(editor.state.doc).map(x=>[x.kind,x.text]),[['ins','你']])
  resolveRevisions(editor,revisions(editor.state.doc),true)
  assert.deepEqual(revisions(editor.state.doc),[])
  assert.equal(editor.state.doc.textContent,'你好')
})

test('普通编辑和清除格式无法移除其他审阅者的插入记录',()=>{
  const editor=fixture([paragraph('A')])
  editor.dispatch(editor.state.tr.insertText('B',2))
  const original=editor.state.doc
  editor.settings.author='乙'
  editor.dispatch(editor.state.tr.delete(2,3))
  editor.dispatch(editor.state.tr.removeMark(1,3))
  assert.equal(editor.state.doc,original)
  assert.equal(editor.messages.length,2)
  resolveRevisions(editor,revisions(editor.state.doc),true)
  assert.equal(editor.state.doc.textContent,'AB')
  assert.deepEqual(revisions(editor.state.doc),[])
})
