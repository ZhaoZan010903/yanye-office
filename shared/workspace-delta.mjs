import { MAX_PAGES, MAX_WORKSPACE_BYTES, assertWorkspace, cacheTxtPageSize, workspaceBytes } from './workspace.mjs'

// Offsets count UTF-16 code units, as in the editor. A splice can cross a
// surrogate boundary, so offsets and inserted strings must round-trip exactly.
function textChange(before, after) {
  let start = 0
  const shortest = Math.min(before.length, after.length)
  const step = 4096
  while (start + step <= shortest && before.slice(start, start + step) === after.slice(start, start + step)) start += step
  while (start < shortest && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let end = 0
  while (end + step <= shortest - start &&
    before.slice(before.length - end - step, before.length - end) === after.slice(after.length - end - step, after.length - end)) end += step
  while (end < shortest - start && before.charCodeAt(before.length - end - 1) === after.charCodeAt(after.length - end - 1)) end++
  return { start, removed: before.length - start - end, inserted: after.slice(start, after.length - end) }
}

function applySplice(original, { start, removed, inserted }) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(removed) || start < 0 || removed < 0 ||
      start + removed > original.length || typeof inserted !== 'string') throw new Error('正文变更位置无效。')
  return original.slice(0, start) + inserted + original.slice(start + removed)
}

// A mixed-ending TXT has two parallel strings: normalized editor text and
// one separator code per logical newline. Both belong to the same transaction.
const textKeys = ['text', 'lineMap']
const knownTxtChanges = new WeakMap()

// Only an edit used to construct this exact pair of objects may bypass diffing.
// Reopened files, migrated data and deserialized IPC messages take the normal path.
export function spliceTxtContent(before, patch, textWindow) {
  const next = { ...before, text:applySplice(before.text, patch) }
  knownTxtChanges.set(next, { before:new WeakRef(before), patch, textWindow })
  return next
}

function plainTextDelta(before, after) {
  const set = Object.fromEntries(Object.entries(after).filter(([key, value]) => !textKeys.includes(key) && value !== before[key]))
  const unset = Object.keys(before).filter(key => !Object.hasOwn(after, key))
  const delta = { set, unset }
  for (const key of textKeys) {
    if (Object.hasOwn(after, key) && after[key] !== before[key]) {
      if (typeof after[key] !== 'string' || (before[key] !== undefined && typeof before[key] !== 'string')) return null
      const known = key === 'text' ? knownTxtChanges.get(after) : undefined
      delta[key] = known?.before.deref() === before ? known.patch : textChange(before[key] ?? '', after[key])
    }
  }
  return delta
}

export function applyPlainTextDelta(before, delta) {
  if (!delta.set || !Array.isArray(delta.unset) || textKeys.some(key => Object.hasOwn(delta.set, key))) throw new Error('TXT 变更字段无效。')
  const next = { ...before, ...delta.set }
  for (const key of delta.unset) delete next[key]
  for (const key of textKeys) if (delta[key]) next[key] = applySplice(before[key] ?? '', delta[key])
  return next
}

export function workspaceDelta(before, after) {
  const previous = new Map(before.pages.map(page => [page.id, page]))
  const changes = []
  const { pages, ...meta } = after
  for (const page of pages) {
    const old = previous.get(page.id)
    previous.delete(page.id)
    if (!old) {
      changes.push({ id: page.id, add: page })
    } else if (old !== page) {
      const set = Object.fromEntries(Object.entries(page).filter(([key, value]) => key !== 'markdown' && key !== 'id' && value !== old[key]))
      const unset = Object.keys(old).filter(key => !Object.hasOwn(page, key))
      const change = { id: page.id, set, unset }
      if (old.markdown !== page.markdown) change.text = textChange(old.markdown, page.markdown)
      if (page.kind === 'txt' && old.kind === 'txt' && set.content && old.content) {
        const delta = plainTextDelta(old.content, set.content)
        if (delta) {
          change.plainText = delta
          delete set.content
          const known = knownTxtChanges.get(page.content)
          cacheTxtPageSize(old, page, delta, known?.before.deref() === old.content ? known.textWindow : undefined)
        }
      }
      if (change.text || change.plainText || unset.length || Object.keys(set).length) changes.push(change)
    }
  }
  for (const id of previous.keys()) changes.push({ id, remove: true })
  const reordered = pages.length !== before.pages.length || pages.some((page, i) => page.id !== before.pages[i].id)
  return { operationId: crypto.randomUUID(), baseRevision: before.revision, meta, changes,
    ...(reordered ? { order: pages.map(page => page.id) } : {}) }
}

export function applyWorkspaceDelta(before, delta) {
  const { baseRevision, meta, changes, order } = delta
  if (before.revision !== baseRevision || meta?.revision !== baseRevision + 1 || Object.hasOwn(meta, 'pages') ||
      !Array.isArray(changes) || changes.length > MAX_PAGES * 2) throw new Error('本次保存与当前工作区版本不一致。')

  const pages = new Map(before.pages.map(page => [page.id, page]))
  const touched = new Set()
  for (const change of changes) {
    const { id } = change
    if (touched.has(id)) throw new Error('同批保存重复修改了页面。')
    touched.add(id)
    if (change.add) {
      if (pages.has(id) || change.add.id !== id) throw new Error('新页面标识已存在或不匹配。')
      pages.set(id, change.add)
    } else {
      const old = pages.get(id)
      if (!old) throw new Error('找不到要保存的页面。')
      if (change.remove) {
        pages.delete(id)
        continue
      }
      const { set, unset, text, plainText } = change
      if (!set || !Array.isArray(unset) || Object.hasOwn(set, 'id') || Object.hasOwn(set, 'markdown') ||
          unset.includes('id') || unset.includes('markdown')) throw new Error('页面变更的字段无效。')
      const page = { ...old, ...set }
      for (const key of unset) delete page[key]
      if (text) page.markdown = applySplice(old.markdown, text)
      if (plainText) {
        if (old.kind !== 'txt' || page.kind !== 'txt' || Object.hasOwn(set, 'content') || unset.includes('content')) throw new Error('TXT 变更目标无效。')
        page.content = applyPlainTextDelta(old.content, plainText)
        cacheTxtPageSize(old, page, plainText)
      }
      pages.set(id, page)
    }
  }
  if (order && (!Array.isArray(order) || order.length !== pages.size || order.some(id => !pages.has(id)))) {
    throw new Error('页面顺序无效。')
  }
  const next = assertWorkspace({ ...meta, pages: order ? order.map(id => pages.get(id)) : [...pages.values()] })
  if (workspaceBytes(next) > MAX_WORKSPACE_BYTES) throw new Error('工作区超过大小上限。')
  return next
}
