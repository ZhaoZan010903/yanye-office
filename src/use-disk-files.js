import { useRef, useState } from 'react'
import { addPage, isVisible, indexPages, makePage, openPage, updatePage, MAX_MARKDOWN_LENGTH, MAX_TITLE_LENGTH } from '../shared/workspace.mjs'
import { fileTitle, fileTypes, pageExtension, readOfficeFile, writeOfficeFile } from './office-files.js'

function binding(file, confirmOverwrite = false) {
  return { id: file.id, name: file.name, extension: file.extension, revision: file.revision, dirty: false, confirmOverwrite }
}

// Save As can target another open document. Retain its workspace copy under its own page ID.
function releaseOtherBindings(workspace, id, fileId) {
  let next = workspace
  for (const page of workspace.pages) {
    if (page.id !== id && page.disk?.id === fileId) next = updatePage(next,page.id,{ disk: null })
  }
  return next
}

export function useDiskFiles({ latest, change, reveal, prompt, notify }) {
  const api = window.yanye?.library
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const [encodingRequest, setEncodingRequest] = useState(null)

  function chooseEncoding(bytes, name) {
    return new Promise(resolve => setEncodingRequest({ bytes, name, finish(encoding) {
      setEncodingRequest(null)
      resolve(encoding)
    } }))
  }

  async function run(work) {
    if (lock.current) return false
    lock.current = true
    setBusy(true)
    try { return await work() } catch (error) {
      const message = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '')
      notify(message)
      throw new Error(message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  function openFile(load) {
    return run(async () => {
      const file = await load()
      if (!file) return false
      const type = fileTypes[file.extension]
      if (!type) throw new Error('此格式尚未提供编辑器。')
      const ws = latest.current
      const byId = indexPages(ws.pages)
      const existing = ws.pages.find(p => p.disk?.id === file.id && isVisible(p, byId))
      const revisionChanged = Boolean(existing && existing.disk.revision !== file.revision)
      const title = fileTitle(file.name, file.extension).slice(0, MAX_TITLE_LENGTH)
      if (existing && (!revisionChanged || existing.disk.dirty)) {
        change(current => openPage(updatePage(current, existing.id, { title, disk: { ...existing.disk, name: file.name } }), existing.id))
        reveal(existing.id)
        if (revisionChanged) notify('磁盘文件已更改。当前显示保留的草稿，可另存为独立文件。')
      } else {
        const data = await readOfficeFile(file, chooseEncoding)
        if (!data) return false
        if (data.markdown?.length > MAX_MARKDOWN_LENGTH) throw new Error('Markdown 文件超过单页字符上限。')
        const page = existing ?? makePage({ title, kind: type.kind })
        const fields = { ...data, title, disk: binding(file, ['docx','xlsx','pptx'].includes(file.extension)) }
        const ok = change(current => {
          if (!existing) return addPage(releaseOtherBindings(current,page.id,file.id), { ...page, ...fields })
          const now = current.pages.find(p=>p.id===page.id)
          return openPage(now?.disk?.dirty ? current : updatePage(current,page.id,fields),page.id)
        })
        if (!ok) return false
        reveal(page.id)
      }
      setEpoch(n => n + 1)
      return true
    })
  }

  function createFile(extension, requestedName, directory) {
    return run(async () => {
      const title = fileTitle(requestedName.trim(), extension).trim()
      if (!title || title.length > MAX_TITLE_LENGTH) throw new Error('请输入 1 至 120 字的文件名。')
      const page = makePage({ title, kind: fileTypes[extension].kind })
      const content = await writeOfficeFile(page)
      const name = title + '.' + extension
      const file = directory == null
        ? await api.save({ asNew: true, name, extension, content })
        : await api.create(directory, name, content)
      if (!file) return false
      const added = change(current => addPage(releaseOtherBindings(current,page.id,file.id), { ...page, title: fileTitle(file.name, extension).slice(0, MAX_TITLE_LENGTH), disk: binding(file) }))
      setEpoch(n => n + 1)
      if (added) reveal(page.id)
      else notify('文件已创建；工作区空间不足，可从文件中心重新打开。')
      return added
    })
  }

  function saveFile(id, asNew = false, confirmed = false) {
    const page = latest.current?.pages.find(p => p.id === id)
    if (!page) return Promise.resolve(false)
    if (page.kind === 'pdf') {
      if (!asNew || !page.disk) { notify('PDF 阅读器保留原件。'); return Promise.resolve(true) }
      return run(async () => {
        const copy = await api.copyPdf(page.disk.id, page.disk.revision)
        if (!copy) return false
        change(current => updatePage(releaseOtherBindings(current,id,copy.id), id, {
          disk:binding(copy), title:fileTitle(copy.name,'pdf').slice(0,MAX_TITLE_LENGTH),
        }))
        setEpoch(n => n + 1)
        notify('已保存 ' + copy.name)
        return true
      })
    }
    if (page.disk?.confirmOverwrite && page.disk.dirty && !asNew && !confirmed) {
      prompt({ type: 'confirm-write', id })
      return Promise.resolve(false)
    }
    return run(async () => {
      if (page.disk && !page.disk.dirty && !asNew) { notify('当前文件已保存。'); return true }
      const extension = pageExtension(page)
      const convertText = extension === 'txt' && page.content?.encoding === 'gb18030'
      const content = await writeOfficeFile(page)
      const name = (page.title.trim() || fileTypes[extension].initialName) + (convertText ? '-UTF8' : '') + '.' + extension
      const file = await api.save({ id: page.disk?.id, revision: page.disk?.revision, asNew:asNew || convertText,
        preserveSource:convertText, name, extension, content })
      if (!file) return false
      if (!page.disk) {
        setEpoch(n => n + 1)
        notify('已导出 ' + file.name)
        return true
      }
      change(current => {
        const now = current.pages.find(p => p.id === id)
        if (!now) return current
        const dirty = now.content !== page.content || now.markdown !== page.markdown
        return updatePage(releaseOtherBindings(current,id,file.id), id, { disk: { ...binding(file), dirty },
          ...(convertText ? { content:{ ...now.content, encoding:'utf-8', bom:false } } : {}),
          title: fileTitle(file.name, extension).slice(0, MAX_TITLE_LENGTH) })
      })
      setEpoch(n => n + 1)
      notify('已保存 ' + file.name)
      return true
    })
  }

  return { busy, epoch, openFile, createFile, saveFile, encodingRequest }
}
