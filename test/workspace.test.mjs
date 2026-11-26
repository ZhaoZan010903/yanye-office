import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { WorkspaceStore } from './fixtures/v05/store.mjs'
import { addPage, assertWorkspace, initialWorkspace, makePage, movePage, restorePage, trashPage, updatePage, visiblePages } from '../shared/workspace.mjs'
import { describeSource } from '../src/markdown.js'

test('creating, moving, trashing and restoring retain page relationships', () => {
  const initial = initialWorkspace()
  const child = makePage({ title: '新笔记', parentId: 'desk' })
  const added = addPage(initial, child)
  assert.equal(added.activeId, child.id)
  assert.equal(movePage(added, 'desk', child.id), added)

  const trashed = trashPage(added, 'desk')
  assert.ok(!visiblePages(trashed.pages).some(page => page.id === child.id))
  assert.notEqual(trashed.activeId, child.id)

  const restored = restorePage(trashed, 'desk')
  assert.equal(restored.activeId, 'desk')
  assert.equal(visiblePages(restored.pages).find(page => page.id === child.id).parentId, 'desk')
  assert.equal(assertWorkspace(restored), restored)
})

test('workspace loading rejects cycles', () => {
  const initial = initialWorkspace()
  const invalid = updatePage(initial, 'desk', { parentId: 'weekly' })
  assert.throws(() => assertWorkspace(invalid), /页面层级/u)
})

test('writes keep the most recent generation and preserve unreadable workspace files', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'yanye-storage-'))
  const file = join(temp, 'workspace.json')
  try {
    const store = new WorkspaceStore(file)
    const initial = await store.load()
    const first = { ...updatePage(initial, 'desk', { markdown: '一' }), revision: 1 }
    const second = { ...updatePage(first, 'desk', { markdown: '二' }), revision: 2 }
    store.stage(first)
    const flushed = store.flush()
    store.stage(second)
    assert.equal(store.stage(first), false)
    await Promise.all([flushed, store.flush()])
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), second)

    await writeFile(file, 'damaged workspace file', 'utf8')
    await assert.rejects(new WorkspaceStore(file).load(), SyntaxError)
    assert.equal(await readFile(file, 'utf8'), 'damaged workspace file')
  } finally {
    if (dirname(temp) === tmpdir() && basename(temp).startsWith('yanye-storage-')) {
      await rm(temp, { recursive: true, force: true })
    }
  }
})

test('source outline skips fenced code and preserves extensions in source mode', () => {
  const text = '## 可见\n\n```html\n<div>\n## 隐藏\n- [x] 示例\n```\n\n- [ ] 真实任务'
  const details = describeSource(text)
  assert.deepEqual(details.headings.map(heading => heading.label), ['可见'])
  assert.equal(details.total, 1)
  assert.equal(details.completed, 0)
  assert.equal(details.sourceOnly, false)
  assert.equal(describeSource('---\ntitle: 草稿\n---\n\n正文').sourceOnly, true)
  assert.equal(describeSource('正文[^甲]').sourceOnly, true)
})
