import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isDeepStrictEqual } from 'node:util'
import { MAX_WORKSPACE_BYTES, assertWorkspace, initialWorkspace } from '../shared/workspace.mjs'
import { applyPlainTextDelta, applyWorkspaceDelta } from '../shared/workspace-delta.mjs'

const digest = input => createHash('sha256').update(input).digest('hex')
const compactAfter = 128
const formatVersion = 2
const createTxtEdits = 'CREATE TABLE txt_edits (doc TEXT REFERENCES pages(id) ON DELETE CASCADE, revision INTEGER, patch TEXT NOT NULL, PRIMARY KEY(doc,revision)) WITHOUT ROWID'

function readLegacy(profile) {
  const filename = join(profile, 'workspace.json')
  let size
  try { size = statSync(filename).size } catch (error) {
    if (error.code === 'ENOENT') return { workspace: initialWorkspace(), checksum: null }
    throw error
  }
  if (size > MAX_WORKSPACE_BYTES) throw new Error('旧工作区文件超过大小上限。')
  const source = readFileSync(filename)
  return { workspace: assertWorkspace(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source))), checksum: digest(source) }
}

export class WorkspaceDatabase {
  constructor(profile) {
    this.db = new DatabaseSync(join(profile, 'workspace.sqlite'))
    this.statements = new Map()
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
      const version = this.db.prepare('PRAGMA user_version').get().user_version
      if (version === 0) this.migrate(profile)
      else if (version === 1) this.transaction(() => {
        this.db.exec(createTxtEdits)
        this.read()
        this.db.exec('PRAGMA user_version=2')
      })
      else if (version !== formatVersion) throw new Error('工作区数据库版本无法读取。')
      this.workspace = this.read()
    } catch (error) {
      this.close()
      throw error
    }
  }

  sql(query) {
    if (!this.statements.has(query)) this.statements.set(query, this.db.prepare(query))
    return this.statements.get(query)
  }

  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = action()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK')
      throw error
    }
  }

  setField(id, key, value) {
    this.sql('INSERT INTO fields(doc,name,value) VALUES(?,?,?) ON CONFLICT(doc,name) DO UPDATE SET value=excluded.value')
      .run(id, key, JSON.stringify(value))
  }

  addPage(page) {
    const { id, markdown, ...fields } = page
    this.sql('INSERT INTO pages(id,body) VALUES(?,?)').run(id, JSON.stringify(markdown))
    for (const [key, value] of Object.entries(fields)) this.setField(id, key, value)
  }

  migrate(profile) {
    if (this.db.prepare("SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get()) {
      throw new Error('现有数据库结构无法识别，已保留原件。')
    }
    const { workspace, checksum } = readLegacy(profile)
    const { pages, ...meta } = workspace
    this.transaction(() => {
      this.db.exec(`
        CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id=1), meta TEXT NOT NULL, ordering TEXT NOT NULL, legacy_sha256 TEXT);
        CREATE TABLE pages (id TEXT PRIMARY KEY, body TEXT NOT NULL, edits INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE fields (doc TEXT REFERENCES pages(id) ON DELETE CASCADE, name TEXT, value TEXT NOT NULL, PRIMARY KEY(doc,name)) WITHOUT ROWID;
        CREATE TABLE text_edits (doc TEXT REFERENCES pages(id) ON DELETE CASCADE, revision INTEGER, splice TEXT NOT NULL, PRIMARY KEY(doc,revision)) WITHOUT ROWID;
        CREATE TABLE commits (revision INTEGER PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, digest TEXT NOT NULL);
      `)
      this.db.exec(createTxtEdits)
      for (const page of pages) this.addPage(page)
      this.sql('INSERT INTO workspace VALUES(1,?,?,?)').run(JSON.stringify(meta), JSON.stringify(pages.map(page => page.id)), checksum)
      // Read back the entire migrated graph before publishing the format marker.
      if (!isDeepStrictEqual(this.read(), workspace)) throw new Error('旧工作区迁移校验失败。')
      this.db.exec('PRAGMA user_version=2')
    })
  }

  read() {
    const header = this.sql('SELECT meta,ordering FROM workspace WHERE id=1').get()
    if (!header) throw new Error('工作区数据库缺少元数据。')
    const pages = new Map()
    for (const { id, body } of this.sql('SELECT id,body FROM pages').iterate()) pages.set(id, { id, markdown: JSON.parse(body) })
    for (const { doc, name, value } of this.sql('SELECT doc,name,value FROM fields').iterate()) {
      Object.defineProperty(pages.get(doc), name, { configurable: true, enumerable: true, writable: true, value: JSON.parse(value) })
    }
    for (const { doc, splice } of this.sql('SELECT doc,splice FROM text_edits ORDER BY doc,revision').iterate()) {
      const page = pages.get(doc)
      const { start, removed, inserted } = JSON.parse(splice)
      if (start < 0 || removed < 0 || start + removed > page.markdown.length) throw new Error('无法恢复正文修订。')
      page.markdown = page.markdown.slice(0, start) + inserted + page.markdown.slice(start + removed)
    }
    for (const { doc, patch } of this.sql('SELECT doc,patch FROM txt_edits ORDER BY doc,revision').iterate()) {
      const page = pages.get(doc)
      page.content = applyPlainTextDelta(page.content, JSON.parse(patch))
    }
    const ids = JSON.parse(header.ordering)
    if (ids.length !== pages.size) throw new Error('工作区页面目录不完整。')
    return assertWorkspace({ ...JSON.parse(header.meta), pages: ids.map(id => pages.get(id)) })
  }

  editPage(change, next, revision) {
    if (change.add) return this.addPage(change.add)
    if (change.remove) return this.sql('DELETE FROM pages WHERE id=?').run(change.id)
    for (const [key, value] of Object.entries(change.set)) this.setField(change.id, key, value)
    for (const key of change.unset) this.sql('DELETE FROM fields WHERE doc=? AND name=?').run(change.id, key)
    if (Object.hasOwn(change.set, 'content') || change.unset.includes('content')) {
      this.sql('DELETE FROM txt_edits WHERE doc=?').run(change.id)
    }
    if (change.plainText) {
      this.sql('INSERT INTO txt_edits(doc,revision,patch) VALUES(?,?,?)').run(change.id, revision, JSON.stringify(change.plainText))
      if (this.sql('SELECT COUNT(*) AS n FROM txt_edits WHERE doc=?').get(change.id).n >= compactAfter) {
        this.setField(change.id, 'content', next.pages.find(page => page.id === change.id).content)
        this.sql('DELETE FROM txt_edits WHERE doc=?').run(change.id)
      }
    }
    if (!change.text) return
    const { edits } = this.sql('UPDATE pages SET edits=edits+1 WHERE id=? RETURNING edits').get(change.id)
    if (edits >= compactAfter) {
      const page = next.pages.find(page => page.id === change.id)
      this.sql('UPDATE pages SET body=?,edits=0 WHERE id=?').run(JSON.stringify(page.markdown), change.id)
      this.sql('DELETE FROM text_edits WHERE doc=?').run(change.id)
    } else {
      this.sql('INSERT INTO text_edits(doc,revision,splice) VALUES(?,?,?)').run(change.id, revision, JSON.stringify(change.text))
    }
  }

  commit(batch) {
    let state = this.workspace
    this.transaction(() => {
      for (const delta of batch) {
        if (typeof delta?.operationId !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(delta.operationId)) {
          throw new Error('无效的保存操作标识。')
        }
        const hash = digest(JSON.stringify(delta))
        if (delta.baseRevision < state.revision) {
          const prior = this.sql('SELECT revision,digest FROM commits WHERE operation_id=?').get(delta.operationId)
          if (prior?.revision === delta.meta.revision && prior.digest === hash) continue
          throw new Error('保存冲突，已保留上次确认的版本。')
        }
        const next = applyWorkspaceDelta(state, delta)
        for (const change of delta.changes) this.editPage(change, next, next.revision)
        if (delta.order) this.sql('UPDATE workspace SET ordering=? WHERE id=1').run(JSON.stringify(delta.order))
        this.sql('UPDATE workspace SET meta=? WHERE id=1').run(JSON.stringify(delta.meta))
        this.sql('INSERT INTO commits(revision,operation_id,digest) VALUES(?,?,?)').run(next.revision, delta.operationId, hash)
        state = next
      }
    })
    this.workspace = state
    return state.revision
  }

  close() {
    this.statements.clear()
    this.db.close()
  }
}
