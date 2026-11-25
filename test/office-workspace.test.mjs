import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { WorkspaceStore, writeAtomically } from '../electron/store.mjs'
import {
  addPage, assertWorkspace, makePage, MAX_WORKSPACE_BYTES, movePage, officeKinds,
  restorePage, trashPage, updatePage, workspaceBytes,
} from '../shared/workspace.mjs'

// This fixture uses only fields written by 0.1, independently of today's page factory.
const date = '2026-11-25T01:00:00.000Z'
const root = { id:'legacy', parentId:null, title:'资料 📘', kind:'note', markdown:'---\r\nkey: 1\r\n---\r\n',
  favorite:true, createdAt:date, updatedAt:date, deletedAt:null }
const child = { ...root, id:'legacy-child', parentId:'legacy', title:'引文', kind:'book', markdown:'A\t"B"\nC' }
const deleted = { ...child, id:'legacy-trash', deletedAt:date }
const legacy = { schemaVersion:1, revision:13, activeId:'legacy', collapsedIds:['legacy'], pages:[root,child,deleted] }

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(),'yanye-office-store-'))
  t.after(() => rm(dir,{recursive:true,force:true,maxRetries:4}))
  return dir
}

test('legacy workspace upgrades on first office page and preserves saved notes and module contents on reload', async t => {
  const file = join(await tempDir(t),'workspace.json')
  const original = JSON.stringify(legacy,null,2)
  await writeFile(file,original,'utf8')
  const store = new WorkspaceStore(file)
  const loaded = await store.load()
  assert.deepEqual(loaded,legacy)
  assert.equal(await readFile(file,'utf8'),original)
  let state = addPage(loaded,makePage({kind:'note',id:'new-note'}))
  assert.equal(state.schemaVersion,1)
  for (const [kind,title] of Object.entries(officeKinds)) {
    state = addPage(state,makePage({id:kind,kind,title,parentId:'legacy'}))
    assert.equal(state.schemaVersion,2)
    assert.deepEqual(state.pages.at(-1).content,{})
  }
  state = updatePage(state,'spreadsheet',{content:{
    sheets:[{id:'sheet-1',name:'单价',rows:24,cols:8,cells:{A1:'5',B1:'=A1*2'}}],active:'sheet-1',
  }})
  state = restorePage(trashPage(movePage(state,'spreadsheet','legacy-child'),'spreadsheet'),'spreadsheet')
  assert.deepEqual(state.pages.slice(0,3),legacy.pages)
  state = {...state, revision:loaded.revision+1}
  assert.equal(store.stage(state),true)
  assert.equal(await store.flush(),14)
  const reopened = await new WorkspaceStore(file).load()
  assert.deepEqual(reopened,state)
  assert.equal(reopened.pages.find(p=>p.id==='spreadsheet').parentId,'legacy-child')
  assert.equal(reopened.pages.find(p=>p.id==='spreadsheet').content.sheets[0].cells.B1,'=A1*2')
})

test('schema loader rejects unsupported versions, office kinds in 0.1, missing office payloads and invalid navigation', () => {
  const sheet = makePage({id:'s',kind:'spreadsheet'})
  const valid = addPage(legacy,sheet)
  for (const version of [0,3,'2']) assert.throws(()=>assertWorkspace({...valid,schemaVersion:version}))
  assert.throws(()=>assertWorkspace({...valid,schemaVersion:1}))
  for (const content of [undefined,null,[],false,'sheet']) {
    assert.throws(()=>assertWorkspace(updatePage(valid,'s',{content})))
  }
  assert.throws(()=>assertWorkspace(updatePage(valid,'s',{kind:'unknown'})))
  assert.throws(()=>assertWorkspace({...valid,activeId:'legacy-trash'}))
  assert.equal(assertWorkspace(valid),valid)
})

test('workspace size calculation matches serialized UTF-8 across page changes, escapes and multibyte text', () => {
  const empty = {...legacy,pages:[],collapsedIds:[],activeId:null}
  let state = addPage(legacy,makePage({kind:'spreadsheet',id:'s'}))
  for (const snapshot of [empty,legacy,state]) {
    assert.equal(workspaceBytes(snapshot),Buffer.byteLength(JSON.stringify(snapshot)))
  }
  const originalBytes = workspaceBytes(state)
  state = updatePage(state,'s',{content:{sheets:[{cells:{A1:'标签🚀',B1:'"引号"\\\n\u0000\t',C1:'\uD800'}}]}})
  assert.ok(workspaceBytes(state) > originalBytes)
  assert.equal(workspaceBytes(state),Buffer.byteLength(JSON.stringify(state)))
  const rotated = {...state,pages:[...state.pages].reverse(),collapsedIds:[]}
  assert.equal(workspaceBytes(rotated),Buffer.byteLength(JSON.stringify(rotated)))
})

test('an oversized staged revision leaves the last workspace intact and the following smaller revision can save', async t => {
  const dir = await tempDir(t), file = join(dir,'workspace.json')
  const store = new WorkspaceStore(file), initial = await store.load()
  const sheet = makePage({id:'s',kind:'spreadsheet'})
  const saved = {...addPage(initial,sheet),revision:1}
  store.stage(saved); await store.flush()
  const reference = await readFile(file,'utf8')
  const payload = {sheets:[{id:'sheet-1',name:'数据',rows:1000,cols:5,cells:{}}]}
  const text = '描'.repeat(9000)
  for (let i=1; i<=940; i++) payload.sheets[0].cells['A'+i]=text
  const oversized = {...updatePage(saved,'s',{content:payload}),revision:2}
  assert.ok(workspaceBytes(oversized) > MAX_WORKSPACE_BYTES)
  // Either reject at staging or reject at flush, but preserve the already durable version.
  await assert.rejects(async()=>{store.stage(oversized);await store.flush()},/大小上限/u)
  assert.equal(await readFile(file,'utf8'),reference)
  const next = {...updatePage(saved,'s',{title:'缩小后'}),revision:3}
  store.stage(next); await store.flush()
  assert.deepEqual(await new WorkspaceStore(file).load(),next)
  assert.deepEqual(await readdir(dir),['workspace.json'])
})

test('failed atomic replacement cleans the temporary file and leaves the destination untouched', async t => {
  const dir = await tempDir(t), occupied = join(dir,'destination')
  await mkdir(occupied)
  await writeFile(join(occupied,'keep'),'saved','utf8')
  await assert.rejects(writeAtomically(occupied,'replacement'))
  assert.equal(await readFile(join(occupied,'keep'),'utf8'),'saved')
  assert.deepEqual(await readdir(dir),['destination'])
})
