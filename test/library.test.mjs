import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileLibrary } from './fixtures/v05/library.mjs'

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'yanye-library-'))
  const profile = join(dir, 'profile')
  const root = join(dir, 'documents')
  const recycle = join(dir, 'recycled')
  await Promise.all([root, profile, recycle].map(path => mkdir(path)))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }))
  const dialog = { root, open: null, save: null }
  const native = { chooseRoot: () => dialog.root, chooseOpen: () => dialog.open, chooseSave: () => dialog.save,
    trash: path => rename(path, join(recycle, basename(path))) }
  const library = new FileLibrary(profile, native)
  return { dir, root, profile, recycle, dialog, invoke: library.invoke.bind(library),
    restart: () => { const next = new FileLibrary(profile, native); return next.invoke.bind(next) } }
}

test('create, list, move and rename real folders; recent file keeps its id over restarts', async t => {
  const { invoke, root, restart } = await setup(t)
  assert.equal((await invoke('state')).root, null)
  await invoke('chooseRoot')
  await invoke('mkdir', '', '季度')
  await invoke('mkdir', '', '资料')
  const file = await invoke('create', '季度', '审阅.md', '春\r\n')
  const rows = await invoke('list', '季度')
  assert.equal(rows[0].path, '季度/审阅.md')
  assert.equal(rows[0].size, Buffer.byteLength('春\r\n'))
  await invoke('rename', '季度', '季度一')
  await invoke('move', '季度一', '资料')
  await assert.rejects(invoke('move', '资料', '资料/季度一'), /自身|下级/)
  await invoke('rename', '资料/季度一/审阅.md', '批注.md')
  const start = restart()
  assert.equal((await start('state')).root, root)
  assert.equal((await start('recent'))[0].name, '批注.md')
  assert.equal((await start('describe', [file.id]))[0].name, '批注.md')
  const reopened = await start('readRecent', file.id)
  assert.equal(reopened.content, '春\r\n')
  assert.equal(reopened.path, join(root, '资料', '季度一', '批注.md'))
  assert.equal((await start('read', '资料/季度一/批注.md')).id, file.id)
})

test('single accepted writer, stale revisions rejected, foreign changes preserved and backup holds exact previous bytes', async t => {
  const { invoke, root, profile } = await setup(t)
  await invoke('chooseRoot')
  const first = await invoke('create', '', '新文件.docx', Buffer.from([80,75,0,1,255]).toString('base64'))
  const save = (revision, data) => invoke('save', { id: first.id, revision, name: first.name, extension: 'docx', content: Buffer.from(data).toString('base64') })
  const results = await Promise.allSettled([save(first.revision,'version 1'),save(first.revision,'version 2')])
  assert.deepEqual(results.map(r => r.status),['fulfilled','rejected'])
  assert.match(results[1].reason.message,/其他程序修改/)
  const path = join(root, '新文件.docx')
  const saved = results[0].value
  assert.equal(dirname(saved.backupPath), join(profile, 'file-backups'))
  assert.deepEqual(await readFile(saved.backupPath), Buffer.from([80,75,0,1,255]))
  assert.equal(await readFile(path,'utf8'), 'version 1')
  await writeFile(path,'changed elsewhere')
  await assert.rejects(save(saved.revision,'again'), /其他程序修改/)
  assert.equal(await readFile(path,'utf8'), 'changed elsewhere')
  await assert.rejects(invoke('create', '', first.name, ''), /已有同名/)
  await rm(path)
  await assert.rejects(save(saved.revision,'again'), /移动或删除/)
})

test('native dialogs honor cancellation and protect existing Save As targets', async t => {
  const { dir, invoke, dialog } = await setup(t)
  assert.equal(await invoke('chooseOpen'), null)
  const source = join(dir, '现有.md')
  const target = join(dir, '副本.md')
  await writeFile(source, '原稿')
  await writeFile(target, '现有副本')
  dialog.open = source
  const opened = await invoke('chooseOpen')
  const req = { id:opened.id, name:opened.name, extension:'md', revision:opened.revision, asNew:true, content:'新副本' }
  assert.equal(await invoke('save',req), null)
  dialog.save = source
  await writeFile(source,'原稿已修改')
  await assert.rejects(invoke('save',req),/其他程序修改/)
  dialog.save = target
  const saved = await invoke('save',req)
  assert.notEqual(opened.id,saved.id)
  assert.equal(await readFile(saved.backupPath,'utf8'),'现有副本')
  assert.equal(await readFile(target,'utf8'),'新副本')
  assert.equal(await readFile(source,'utf8'),'原稿已修改')
})

test('folder paths reject traversal, device names and junction escapes; recycling removes descendant handles', async t => {
  const { dir, root, invoke, recycle } = await setup(t)
  await invoke('chooseRoot')
  for (const path of ['../outer', '/root', 'C:/docs','a/../b','CON','x:y']) await assert.rejects(invoke('list',path))
  for (const name of ['C:xx','a/b.md','NUL.txt','foo.','..']) await assert.rejects(invoke('mkdir','',name))
  const outside = join(dir,'outside')
  await mkdir(outside)
  await symlink(outside,join(root,'link'),process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(outside,'private.md'),'outside')
  await assert.rejects(invoke('read','link/private.md'),/符号链接|目录联接/)
  await assert.rejects(invoke('mkdir','link','bad'),/符号链接|目录联接/)
  assert.equal((await invoke('list','')).length,0)
  await invoke('mkdir','','待删')
  const file = await invoke('create','待删','摘要.md','本地测试')
  await invoke('trash','待删')
  assert.ok((await stat(join(recycle,'待删','摘要.md'))).isFile())
  assert.deepEqual(await invoke('recent'),[])
  assert.deepEqual(await invoke('describe', [file.id]), [])
  await assert.rejects(invoke('readRecent',file.id),/移除/)
})

test('failed renames preserve same-name files; concurrent exclusive creation succeeds once', async t => {
  const { invoke,root } = await setup(t)
  await invoke('chooseRoot')
  const results = await Promise.allSettled([invoke('create','','甲.md','1'),invoke('create','','甲.md','2')])
  assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected'])
  await invoke('create','','乙.md','3')
  await assert.rejects(invoke('rename','甲.md','乙.md'),/已有同名/)
  assert.equal(await readFile(join(root,'甲.md'),'utf8'),'1')
  assert.equal(await readFile(join(root,'乙.md'),'utf8'),'3')
})

test('previous file bytes can be exported to a new location without changing the open file', async t => {
  const { invoke, root, dir, dialog } = await setup(t)
  await invoke('chooseRoot')
  const file = await invoke('create', '', '备忘.md', '原件')
  await assert.rejects(invoke('exportBackup', file.id), /还没有/)
  await invoke('save', { ...file, content: '修订' })
  assert.equal(await invoke('exportBackup', file.id), null)
  dialog.save = join(root, '备忘.md')
  await assert.rejects(invoke('exportBackup', file.id), /同名/)
  assert.equal(await readFile(dialog.save, 'utf8'), '修订')
  dialog.save = join(dir, '上次原件.md')
  assert.equal((await invoke('exportBackup', file.id)).path, dialog.save)
  assert.equal(await readFile(dialog.save, 'utf8'), '原件')
  await assert.rejects(invoke('exportBackup', 'unknown'), /移除/)
})

test('Office text-replacement copies require an unchanged source and a new filename', async t => {
  const { invoke, root, dialog } = await setup(t)
  await invoke('chooseRoot')
  const bytes = Uint8Array.from([80,75,3,4,10,20])
  const file = await invoke('create','','样本.docx',Buffer.from(bytes).toString('base64'))
  assert.deepEqual(await invoke('readOfficeSource',file.id,file.revision),bytes)
  const copy = () => invoke('saveOfficeCopy',file.id,file.revision,bytes)
  assert.equal(await copy(),null)
  dialog.save = file.path
  await assert.rejects(copy(),/新文件名/)
  dialog.save = join(root,'副本.docx')
  await writeFile(dialog.save,'已有文件')
  await assert.rejects(copy(),/已有同名/)
  assert.equal(await readFile(dialog.save,'utf8'),'已有文件')
  dialog.save = join(root,'其他副本.docx')
  await writeFile(file.path,'其他程序写入的内容')
  await assert.rejects(copy(),/原件已经变化/)
  await assert.rejects(invoke('readOfficeSource',file.id,file.revision),/原件已经变化/)
  await assert.rejects(stat(dialog.save),{code:'ENOENT'})
})
