import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WorkspaceDatabase } from './fixtures/v05/workspace-database.mjs'
import { settleWorkspaceForClose } from './fixtures/v05/store.mjs'
import { addPage, makePage, updatePage, initialWorkspace, trashPage, MAX_WORKSPACE_BYTES, workspaceBytes } from '../shared/workspace.mjs'
import { applyWorkspaceDelta, workspaceDelta } from '../shared/workspace-delta.mjs'

async function profile(t) {
  const dir = await mkdtemp(join(tmpdir(), 'yanye-db-test-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }))
  return dir
}
const edit = (workspace, id, fields) => ({ ...updatePage(workspace, id, fields), revision: workspace.revision + 1 })

test('closing drains edits received during the dirty-file check and subsequent file operations', async () => {
  let queue = Promise.resolve(), pending = ['甲'], checks = 0
  const written = []
  const store = {
    get hasPending() { return pending.length > 0 },
    async dirtyFiles() {
      if (++checks === 1) {
        pending.push('乙')
        return []
      }
      if (checks === 2) queue = Promise.resolve().then(() => pending.push('丙'))
      return ['账目.txt']
    },
  }
  const dirty = await settleWorkspaceForClose({ idle:() => queue }, store, async () => {
    written.push(...pending)
    pending = []
  })
  assert.deepEqual(written, ['甲','乙','丙'])
  assert.deepEqual(dirty, ['账目.txt'])
  assert.equal(checks, 3)
})

// Wait for the test writer to enter a known transaction, then terminate only
// the process this test launched. No app profile or user process is involved.
async function interruptTransaction(script, dir, t) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir], { stdio: ['ignore','pipe','inherit'], windowsHide: true })
  const exited = once(child, 'exit')
  t.after(() => child.kill('SIGKILL'))
  const [signal] = await Promise.race([once(child.stdout, 'data'), exited.then(() => { throw new Error('写入进程提前退出。') })])
  assert.equal(signal.toString(), 'in-transaction')
  child.kill('SIGKILL')
  await exited
}

for (const version of [1, 2, 3]) test('migrates legacy schema ' + version + ' and leaves the source byte-for-byte intact', async t => {
  const dir = await profile(t)
  let old = trashPage(initialWorkspace(), 'weekly')
  if (version >= 2) old = addPage(old, makePage({ kind: 'database', title: '任务' }))
  if (version === 3) {
    const file = makePage({ kind: 'word', title: '报价' })
    old = addPage(old, { ...file, disk: { id: 'bound', extension: 'docx', name: '报价.docx', revision: 'hash', dirty: true } })
  }
  old.revision = 7
  const path = join(dir, 'workspace.json')
  const legacy = JSON.stringify(old, null, 2)
  await writeFile(path, legacy)
  let db = new WorkspaceDatabase(dir)
  assert.deepEqual(db.workspace, old)
  assert.equal(db.db.prepare('SELECT legacy_sha256 FROM workspace').get().legacy_sha256, createHash('sha256').update(legacy).digest('hex'))
  const next = edit(old, 'reading', { title: '迁移后编辑' })
  db.commit([workspaceDelta(old, next)])
  db.close()
  db = new WorkspaceDatabase(dir)
  assert.deepEqual(db.workspace, next)
  db.close()
  assert.equal(await readFile(path, 'utf8'), legacy)
})

test('invalid legacy data survives a failed migration and a corrected source can be retried', async t => {
  const dir = await profile(t)
  const path = join(dir, 'workspace.json')
  await writeFile(path, '损坏的旧数据')
  assert.throws(() => new WorkspaceDatabase(dir))
  assert.equal(await readFile(path, 'utf8'), '损坏的旧数据')
  const original = initialWorkspace()
  await writeFile(path, JSON.stringify(original))
  const db = new WorkspaceDatabase(dir)
  assert.deepEqual(db.workspace, original)
  db.close()
})

test('an interrupted first migration can restart without duplicating pages or changing the source', { timeout: 20000 }, async t => {
  const dir = await profile(t)
  const path = join(dir, 'workspace.json')
  const original = initialWorkspace()
  const json = JSON.stringify(original)
  await writeFile(path, json)
  const moduleUrl = new URL('./fixtures/v05/workspace-database.mjs', import.meta.url).href
  await interruptTransaction(`
    import { WorkspaceDatabase } from ${JSON.stringify(moduleUrl)}
    const insert = WorkspaceDatabase.prototype.addPage
    WorkspaceDatabase.prototype.addPage = function(page) {
      insert.call(this, page)
      process.stdout.write('in-transaction')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000)
    }
    new WorkspaceDatabase(process.argv[1])
  `, dir, t)
  assert.equal(await readFile(path, 'utf8'), json)
  const recovered = new WorkspaceDatabase(dir)
  assert.deepEqual(recovered.workspace, original)
  assert.equal(recovered.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  recovered.close()
})

test('emoji replacements keep complete UTF-16 pairs across JSON IPC and embedded NUL through SQLite', async t => {
  const dir = await profile(t)
  const db = new WorkspaceDatabase(dir)
  const one = edit(db.workspace, 'desk', { markdown: '甲\0😀\0乙' })
  db.commit([workspaceDelta(db.workspace, one)])
  const two = edit(one, 'desk', { markdown: '甲\0😁\0乙' })
  const delta = workspaceDelta(one, two)
  assert.equal(delta.changes[0].text.inserted, '😁')
  db.commit([delta])
  db.close()
  const reopened = new WorkspaceDatabase(dir)
  assert.deepEqual(reopened.workspace, two)
  reopened.close()
})

test('small document edits store only changed text, handle UTF-16 and compact the edited page', async t => {
  const dir = await profile(t)
  const db = new WorkspaceDatabase(dir)
  const page = makePage({ id: 'new', markdown: '本地'.repeat(40000) + '😀' })
  let workspace = { ...addPage(db.workspace, page), revision: 1 }
  db.commit([workspaceDelta(db.workspace, workspace)])
  for (let i = 0; i < 132; i++) {
    const text = workspace.pages.at(-1).markdown
    const next = edit(workspace, 'new', { markdown: text.slice(0, -2) + String(i % 10) + '😁' })
    const delta = workspaceDelta(workspace, next)
    assert.ok(JSON.stringify(delta).length < 600)
    assert.deepEqual(applyWorkspaceDelta(workspace, delta), next)
    assert.equal(db.commit([delta]), next.revision)
    if (i === 0) {
      assert.equal(db.db.prepare("SELECT body FROM pages WHERE id='new'").get().body, JSON.stringify(page.markdown))
      assert.ok(db.db.prepare('SELECT length(splice) AS n FROM text_edits').get().n < 100)
    }
    workspace = next
  }
  assert.equal(db.db.prepare("SELECT edits FROM pages WHERE id='new'").get().edits, 4)
  assert.deepEqual(db.read(), workspace)
  db.close()
  const recovered = new WorkspaceDatabase(dir)
  assert.deepEqual(recovered.workspace, workspace)
  recovered.close()
})

test('batch failure rolls back every page, duplicate delivery after restart is idempotent', async t => {
  const dir = await profile(t)
  const writer = new WorkspaceDatabase(dir)
  const original = writer.workspace
  const one = edit(original, 'reading', { markdown: '第一次' })
  const two = edit(one, 'desk', { markdown: '第二次' })
  const first = workspaceDelta(original, one), second = workspaceDelta(one, two)
  const broken = structuredClone(second)
  broken.changes[0].text.start = -1
  assert.throws(() => writer.commit([first, broken]))
  assert.deepEqual(writer.read(), original)
  assert.equal(writer.commit([first, second]), two.revision)
  writer.close()
  const restarted = new WorkspaceDatabase(dir)
  assert.equal(restarted.commit([first, second]), two.revision)
  assert.equal(restarted.db.prepare('SELECT COUNT(*) AS n FROM commits').get().n, 2)
  assert.throws(() => restarted.commit([{ ...first, meta: { ...first.meta, activeId: null } }]), /冲突/u)
  restarted.close()
})

test('TXT splices persist text, mixed line endings and encoding together, including undo, compaction and version 1 databases', async t => {
  const dir = await profile(t)
  let writer = new WorkspaceDatabase(dir)
  const text = { text: '头\n正文\n尾', lineMap: 'wr', eol: 'w', encoding: 'utf-16le', bom: true }
  const page = { ...makePage({ id: 'txt', kind: 'txt' }), content: text }
  const first = { ...addPage(writer.workspace, page), revision: 1 }
  writer.commit([workspaceDelta(writer.workspace, first)])
  // The previous storage version kept all TXT content in a single field.
  writer.db.exec('DROP TABLE txt_edits; PRAGMA user_version=1')
  writer.close()
  writer = new WorkspaceDatabase(dir)
  assert.deepEqual(writer.workspace, first)
  let state = writer.workspace
  const changed = { text: '头\n增\n正文\n尾', lineMap: 'wwr', eol: 'w', encoding: 'utf-8', bom: false }
  for (let i = 0; i < 129; i++) {
    const next = edit(state, 'txt', { content: i % 2 === 0 ? changed : text })
    const delta = workspaceDelta(state, next)
    assert.equal(delta.changes[0].set.content, undefined)
    assert.ok(delta.changes[0].plainText.text)
    assert.ok(delta.changes[0].plainText.lineMap)
    writer.commit([delta])
    state = next
  }
  assert.equal(writer.db.prepare('SELECT COUNT(*) AS n FROM txt_edits').get().n, 1)
  assert.deepEqual(writer.read(), state)
  const { lineMap: unused, ...withoutMap } = text
  const singleEnding = edit(state, 'txt', { content: withoutMap })
  writer.commit([workspaceDelta(state, singleEnding)])
  writer.close()
  const recovered = new WorkspaceDatabase(dir)
  assert.deepEqual(recovered.workspace, singleEnding)
  recovered.close()
})

test('a one-character edit in a 10 MiB TXT sends and journals less than one KiB, and oversized edits preserve the last commit', async t => {
  const dir = await profile(t)
  const db = new WorkspaceDatabase(dir)
  const content = { text: ('a'.repeat(99) + '\n').repeat(100_000) + '字'.repeat(162_000),
    lineMap: 'wn'.repeat(50_000), encoding: 'utf-8', eol: 'n', bom: false }
  const page = { ...makePage({ id: 'txt', kind: 'txt' }), content }
  const before = { ...addPage(db.workspace, page), revision: 1 }
  db.commit([workspaceDelta(db.workspace, before)])
  workspaceBytes(before)
  const next = edit(before, 'txt', { content: { ...content, text: content.text + '砚' } })
  const delta = workspaceDelta(before, next)
  assert.ok(Buffer.byteLength(JSON.stringify(delta)) < 1024)
  assert.equal(workspaceBytes(next), Buffer.byteLength(JSON.stringify(next)))
  db.commit([delta])
  const { bytes } = db.db.prepare('SELECT length(CAST(patch AS BLOB)) AS bytes FROM txt_edits').get()
  assert.ok(bytes < 1024)
  const large = edit(next, 'txt', { content: { ...content, text: 'x'.repeat(MAX_WORKSPACE_BYTES) } })
  assert.throws(() => db.commit([workspaceDelta(next, large)]), /大小上限/u)
  assert.deepEqual(db.read(), next)
  db.close()
})

test('cached TXT quotas match actual serialized UTF-8 across surrogate boundaries, escaped strings and format metadata', () => {
  const initial = { text: '😄\"\\\n\0甲\ud800\ud800\udcff', eol: 'n', bom: false, encoding: 'utf-8' }
  const page = { ...makePage({ id: 'txt', kind: 'txt' }), content: initial }
  let before = addPage(initialWorkspace(), page)
  workspaceBytes(before)
  const vals = ['\udc00', '', '甲', '\"', '\ud800', '😀', '\\', '\n']
  for (let i = 0; i < 91; i++) {
    const current = before.pages.at(-1).content
    const start = i % (current.text.length + 1), end = Math.min(current.text.length, start + (i % 3))
    const content = { ...current, text: current.text.slice(0, start) + vals[i % vals.length] + current.text.slice(end), bom: !current.bom }
    if (i % 3 === 0) delete content.lineMap
    else content.lineMap = 'w'.repeat(i % 5)
    const next = edit(before, 'txt', { content })
    const delta = workspaceDelta(before, next)
    const bytes = Buffer.byteLength(JSON.stringify(next))
    assert.equal(workspaceBytes(next), bytes)
    assert.equal(workspaceBytes(applyWorkspaceDelta(before, delta)), bytes)
    before = next
  }
})

test('reopening after forced writer death recovers acknowledged WAL commits and rolls back in-flight edits', { timeout: 20000 }, async t => {
  const dir = await profile(t)
  const moduleUrl = new URL('./fixtures/v05/workspace-database.mjs', import.meta.url).href
  const deltaUrl = new URL('../shared/workspace-delta.mjs', import.meta.url).href
  const script = `
    import { WorkspaceDatabase } from ${JSON.stringify(moduleUrl)}
    import { workspaceDelta } from ${JSON.stringify(deltaUrl)}
    const db = new WorkspaceDatabase(process.argv[1])
    const change = title => {
      const prev = db.workspace
      const next = { ...prev, revision: prev.revision+1, pages: prev.pages.map(p => p.id === 'desk' ? {...p,title} : p) }
      db.commit([workspaceDelta(prev,next)])
    }
    change('已确认')
    const editPage = db.editPage.bind(db)
    db.editPage = (...args) => {
      editPage(...args)
      process.stdout.write('in-transaction')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000)
    }
    change('未确认')
  `
  await interruptTransaction(script, dir, t)
  const recovered = new WorkspaceDatabase(dir)
  assert.equal(recovered.workspace.revision, 1)
  assert.equal(recovered.workspace.pages.find(page => page.id === 'desk').title, '已确认')
  assert.equal(recovered.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  recovered.close()
})
