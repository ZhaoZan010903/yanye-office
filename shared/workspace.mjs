export const MAX_TITLE_LENGTH = 120
export const MAX_MARKDOWN_LENGTH = 2_000_000
export const MAX_PAGES = 2_000
export const MAX_WORKSPACE_BYTES = 24 * 1024 * 1024

export const officeKinds = Object.freeze({
  word: 'Word 文档',
  spreadsheet: '电子表格',
  database: '多维表格',
  canvas: '流程图与白板',
  presentation: '演示文稿',
})
const pageKinds = new Set(['note', 'desk', 'journal', 'book', 'inbox', 'collection', ...Object.keys(officeKinds)])

const pageSizes = new WeakMap()
const encoder = new TextEncoder()

export function workspaceBytes(workspace) {
  let bytes = encoder.encode(JSON.stringify({ ...workspace, pages: [] })).length + Math.max(0, workspace.pages.length - 1)
  for (const page of workspace.pages) {
    if (!pageSizes.has(page)) pageSizes.set(page, encoder.encode(JSON.stringify(page)).length)
    bytes += pageSizes.get(page)
  }
  return bytes
}

export function pageTitle(page) {
  return page.title.trim() || '未命名页面'
}

export function makePage({ id = crypto.randomUUID(), title = '', markdown = '', parentId = null, kind = 'note', favorite = false } = {}) {
  const now = new Date().toISOString()
  return { id, title, markdown, parentId, kind, favorite, createdAt: now, updatedAt: now, deletedAt: null,
    ...(Object.hasOwn(officeKinds, kind) ? { content: {} } : {}) }
}

export function initialWorkspace() {
  return {
    schemaVersion: 1,
    revision: 0,
    activeId: 'desk',
    collapsedIds: [],
    pages: [
      makePage({
        id: 'desk', kind: 'desk', title: '写作工作台',
        markdown: `把手头的草稿、资料和灵感放在同一个地方。先记下正在想的事，整理可以晚一点。

> 每天留一个明确的问题，再给它一段可以接着写的笔记。

## 今日清单

- [x] 写下今天最想弄清楚的问题
- [ ] 整理收件箱里的两条灵感
- [ ] 为正在写的文章列一个提纲

## 随手记

最近在试一种写法：每篇笔记都记录一个问题、一条线索和一个下一步。下次打开时，从其中一条接着写。

## 长文草稿

**暂定题目**　怎样让笔记回到写作里？

从一条用得上的笔记写起。描述它在什么时候被找到，怎样改变了下一段文字。
`,
      }),
      makePage({ id: 'weekly', parentId: 'desk', kind: 'journal', title: '周间摘记', markdown: '## 本周记住的事\n\n- \n\n## 下周想继续的事\n\n- [ ] \n' }),
      makePage({ id: 'reading', parentId: 'desk', kind: 'book', title: '阅读卡片', favorite: true, markdown: '## 出处\n\n记下书名、作者或链接。\n\n## 带走的想法\n\n用自己的话写下能用到的一点。\n' }),
      makePage({ id: 'inbox', kind: 'inbox', title: '灵感收件箱', favorite: true, markdown: '随手放下一闪而过的念头。\n\n- [ ] 把一个常用流程写成一张卡片\n- [ ] 找一篇文章，做一份反向提纲\n' }),
      makePage({ id: 'references', kind: 'collection', title: '资料索引', markdown: '## 常用资料\n\n| 条目 | 用途 |\n| --- | --- |\n| 写作工作台 | 草稿与日常记录 |\n| 阅读卡片 | 保存可复用的摘记 |\n' }),
      makePage({ id: 'projects', kind: 'note', title: '项目笔记', markdown: '## 问题\n\n这个项目要解决什么？\n\n## 下一步\n\n- [ ] 写下一个能完成的小动作\n' }),
    ],
  }
}

export function indexPages(pages) {
  return new Map(pages.map(page => [page.id, page]))
}

export function ancestors(page, byId) {
  const chain = []
  for (let parent = byId.get(page.parentId); parent; parent = byId.get(parent.parentId)) {
    chain.unshift(parent)
  }
  return chain
}

export function isVisible(page, byId) {
  for (let current = page; current; current = byId.get(current.parentId)) {
    if (current.deletedAt) return false
  }
  return Boolean(page)
}

export function visiblePages(pages) {
  const byId = indexPages(pages)
  return pages.filter(page => isVisible(page, byId))
}

export function openPage(workspace, id) {
  const byId = indexPages(workspace.pages)
  const page = byId.get(id)
  if (!isVisible(page, byId)) return workspace

  const parentIds = new Set(ancestors(page, byId).map(parent => parent.id))
  const collapsedIds = workspace.collapsedIds.filter(parentId => !parentIds.has(parentId))
  if (workspace.activeId === id && collapsedIds.length === workspace.collapsedIds.length) return workspace
  return { ...workspace, activeId: id, collapsedIds }
}

export function addPage(workspace, page) {
  if (workspace.pages.length >= MAX_PAGES) throw new Error('工作区已达到页面数量上限。')
  const byId = indexPages(workspace.pages)
  if (page.parentId && !isVisible(byId.get(page.parentId), byId)) {
    throw new Error('父页面已移动到回收站。')
  }
  const schemaVersion = Math.max(workspace.schemaVersion, page.disk || page.kind === 'word' ? 3 : Object.hasOwn(officeKinds, page.kind) ? 2 : 1)
  return openPage({ ...workspace, schemaVersion, pages: [...workspace.pages, page] }, page.id)
}

export function updatePage(workspace, id, fields) {
  const page = workspace.pages.find(candidate => candidate.id === id)
  if (!page || Object.entries(fields).every(([key, value]) => page[key] === value)) return workspace
  return {
    ...workspace,
    schemaVersion: fields.disk ? 3 : workspace.schemaVersion,
    pages: workspace.pages.map(candidate => candidate.id === id
      ? { ...candidate, ...fields, updatedAt: new Date().toISOString() }
      : candidate),
  }
}

export function canMoveTo(page, parentId, byId) {
  if (parentId === null) return true
  const parent = byId.get(parentId)
  return isVisible(parent, byId) && parent.id !== page.id && !ancestors(parent, byId).some(item => item.id === page.id)
}

export function movePage(workspace, id, parentId) {
  const byId = indexPages(workspace.pages)
  const page = byId.get(id)
  if (!isVisible(page, byId) || !canMoveTo(page, parentId, byId)) return workspace
  const moved = updatePage(workspace, id, { parentId })
  return moved.activeId === id ? openPage(moved, id) : moved
}

export function trashPage(workspace, id) {
  const previous = indexPages(workspace.pages)
  const page = previous.get(id)
  if (!isVisible(page, previous)) return workspace
  const next = updatePage(workspace, id, { deletedAt: new Date().toISOString() })
  const byId = indexPages(next.pages)
  if (isVisible(byId.get(next.activeId), byId)) return next
  const fallback = byId.get(page.parentId) ?? next.pages.find(item => isVisible(item, byId))
  return fallback ? openPage(next, fallback.id) : { ...next, activeId: null }
}

export function restorePage(workspace, id) {
  const byId = indexPages(workspace.pages)
  const page = byId.get(id)
  if (!page?.deletedAt) return workspace
  const parentId = isVisible(byId.get(page.parentId), byId) ? page.parentId : null
  return openPage(updatePage(workspace, id, { deletedAt: null, parentId }), id)
}

export function setCollapsed(workspace, id, collapsed) {
  return {
    ...workspace,
    collapsedIds: collapsed
      ? [...new Set([...workspace.collapsedIds, id])]
      : workspace.collapsedIds.filter(item => item !== id),
  }
}

export function assertWorkspace(workspace) {
  if (!workspace || ![1, 2, 3].includes(workspace.schemaVersion) || !Number.isSafeInteger(workspace.revision) || workspace.revision < 0 ||
      !Array.isArray(workspace.pages) || workspace.pages.length > MAX_PAGES || !Array.isArray(workspace.collapsedIds)) {
    throw new Error('工作区文件格式无法读取。')
  }

  const byId = new Map()
  for (const page of workspace.pages) {
    if (!page || typeof page.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(page.id) || byId.has(page.id) ||
        typeof page.title !== 'string' || page.title.length > MAX_TITLE_LENGTH ||
        typeof page.markdown !== 'string' || page.markdown.length > MAX_MARKDOWN_LENGTH ||
        !pageKinds.has(page.kind) || typeof page.favorite !== 'boolean' ||
        (Object.hasOwn(officeKinds, page.kind) && (workspace.schemaVersion < 2 || !page.content || typeof page.content !== 'object' || Array.isArray(page.content))) ||
        (page.kind === 'word' && workspace.schemaVersion < 3) ||
        (page.disk != null && (workspace.schemaVersion < 3 || typeof page.disk.id !== 'string' ||
          typeof page.disk.name !== 'string' || !['docx','xlsx','pptx','md'].includes(page.disk.extension) ||
          typeof page.disk.revision !== 'string' || typeof page.disk.dirty !== 'boolean')) ||
        typeof page.createdAt !== 'string' || typeof page.updatedAt !== 'string' ||
        !(page.deletedAt === null || typeof page.deletedAt === 'string')) {
      throw new Error('工作区包含无效的页面。')
    }
    byId.set(page.id, page)
  }

  const checked = new Set()
  for (const page of workspace.pages) {
    const chain = new Set()
    for (let current = page; current && !checked.has(current.id); current = byId.get(current.parentId)) {
      if (chain.has(current.id) || (current.parentId !== null && !byId.has(current.parentId))) {
        throw new Error('工作区包含无效的页面层级。')
      }
      chain.add(current.id)
    }
    for (const id of chain) checked.add(id)
  }

  if ((workspace.activeId !== null && !isVisible(byId.get(workspace.activeId), byId)) ||
      workspace.collapsedIds.some(id => !byId.has(id)) || new Set(workspace.collapsedIds).size !== workspace.collapsedIds.length) {
    throw new Error('工作区包含无效的导航状态。')
  }
  return workspace
}
