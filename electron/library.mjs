import { createHash, randomUUID } from 'node:crypto'
import { isUtf8 } from 'node:buffer'
import { constants } from 'node:fs'
import { copyFile, link, lstat, mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { writeAtomically } from './store.mjs'

export const officeExtensions = ['docx', 'xlsx', 'pptx', 'md', 'txt', 'pdf']
const editable = new Set([...officeExtensions, 'csv'])
const binary = new Set(['docx', 'xlsx', 'pptx', 'txt'])
const maxBytes = 32 * 1024 * 1024
const extensionOf = path => extname(path).slice(1).toLowerCase()
const digest = data => createHash('sha256').update(data).digest('hex')
const order = new Intl.Collator('zh-CN', { numeric: true })
const same = (a, b) => relative(a, b) === ''
function within(parent, path) {
  const suffix = relative(parent, path)
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep))
}

function validName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 255 || /[<>:"/\\|?*\x00-\x1f]|[. ]$/u.test(name) ||
    /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name)) throw new Error('请输入有效的 Windows 文件名。')
  return name
}

async function infoIfPresent(path) {
  try { return await lstat(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

function validateExtension(extension) {
  if (!editable.has(extension)) throw new Error('此文件格式暂不能在文件中心编辑。')
}

function encodeContent(content, extension) {
  if (typeof content !== 'string' || content.length > Math.ceil(maxBytes / 3) * 4) throw new Error('文件内容无效或超过 32 MiB。')
  const bytes = Buffer.from(content, binary.has(extension) ? 'base64' : 'utf8')
  if (bytes.length > maxBytes) throw new Error('文件超过 32 MiB。')
  if (binary.has(extension) && bytes.toString('base64') !== content) throw new Error('办公文件编码无效。')
  return bytes
}

async function canonicalExisting(path) {
  if (!same(path, await realpath(path)) || (await lstat(path)).isSymbolicLink()) throw new Error('不能通过符号链接或目录联接操作文件。')
  return path
}

async function readBytes(path) {
  await canonicalExisting(path)
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > maxBytes) throw new Error('请选择 32 MiB 以内的普通文件。')
    const bytes = await file.readFile()
    if (bytes.length > maxBytes) throw new Error('文件超过 32 MiB。')
    return { bytes, modifiedAt: info.mtime.toISOString() }
  } finally { await file.close() }
}

async function exclusiveWrite(path, bytes) {
  const handle = await open(path, 'wx').catch(error => {
    if (error.code === 'EEXIST') throw new Error('已有同名文件或文件夹。')
    throw error
  })
  try {
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  } catch (error) {
    await unlink(path).catch(() => {})
    throw error
  }
}

export class FileLibrary {
  constructor(profile, platform) {
    this.profile = resolve(profile)
    this.indexFile = join(this.profile, 'file-library.json')
    this.platform = platform
    this.root = null
    this.files = []
    this.loaded = false
    this.queue = Promise.resolve()
  }

  // Disk changes and their path bindings form one ordered stream for all windows and IPC callers.
  invoke(method, ...args) {
    const work = this.queue.then(async () => {
      if (!this.loaded) await this.load()
      return this[method](...args)
    })
    this.queue = work.catch(() => {})
    return work
  }

  idle() { return this.queue }

  async load() {
    let data
    try { data = JSON.parse(await readFile(this.indexFile, 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (data) {
      if (data.version !== 1 || (data.root !== null && (typeof data.root !== 'string' || !isAbsolute(data.root))) ||
          !Array.isArray(data.files) || data.files.some(f => !f || !/^[\da-f-]{36}$/i.test(f.id) ||
          typeof f.path !== 'string' || !isAbsolute(f.path) || typeof f.modifiedAt !== 'string')) throw new Error('文件中心索引无法读取。')
      this.root = data.root
      this.files = data.files
    }
    this.loaded = true
  }

  async persist() {
    await mkdir(this.profile, { recursive: true })
    await writeAtomically(this.indexFile, JSON.stringify({ version: 1, root: this.root, files: this.files }))
  }

  state() { return { root: this.root } }

  async chooseRoot() {
    const path = await this.platform.chooseRoot(this.root)
    if (!path) return null
    const canonical = await realpath(path)
    if (!(await stat(canonical)).isDirectory() || within(this.profile, canonical)) throw new Error('请选择保存办公文件的文件夹。')
    this.root = canonical
    await this.persist()
    return this.state()
  }

  async pathInRoot(input, allowRoot = false) {
    if (!this.root) throw new Error('请先选择本地文件夹。')
    if (typeof input !== 'string' || (input === '' && !allowRoot)) throw new Error('文件路径无效。')
    const parts = input === '' ? [] : input.split('/')
    parts.forEach(validName)
    const path = join(this.root, ...parts)
    if (!within(this.root, path) || within(this.profile, path)) throw new Error('不能操作此目录。')
    return canonicalExisting(path)
  }

  async folder(input) {
    const path = await this.pathInRoot(input, true)
    if (!(await stat(path)).isDirectory()) throw new Error('目标不是文件夹。')
    return path
  }

  row(path) { return { name: basename(path), path: relative(this.root, path).split(sep).join('/') } }

  async list(dir = '') {
    const parent = await this.folder(dir)
    const entries = await readdir(parent, { withFileTypes: true })
    const rows = []
    // Chunk metadata requests so a large directory cannot exhaust file handles.
    for (let start = 0; start < entries.length; start += 48) {
      const group = await Promise.all(entries.slice(start, start + 48).map(async entry => {
        const path = join(parent, entry.name)
        if ((!entry.isDirectory() && !entry.isFile()) || within(this.profile, path)) return null
        const info = await infoIfPresent(path)
        if (!info || info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) return null
        return { ...this.row(path), isDirectory: info.isDirectory(), size: info.isDirectory() ? 0 : info.size,
          extension: info.isDirectory() ? '' : extensionOf(path), modifiedAt: info.mtime.toISOString() }
      }))
      rows.push(...group.filter(Boolean))
    }
    return rows.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || order.compare(a.name, b.name))
  }

  async mkdir(dir, name) {
    const path = join(await this.folder(dir), validName(name))
    await mkdir(path).catch(error => { if (error.code === 'EEXIST') throw new Error('已有同名文件或文件夹。'); throw error })
    return this.row(path)
  }

  protect(path) {
    if (within(path, this.profile) || within(this.profile, path)) throw new Error('不能修改砚页数据目录或它的上级目录。')
  }

  async relocate(source, destination) {
    this.protect(source)
    this.protect(destination)
    if (source === destination) return this.row(source)
    if (!same(source, destination)) {
      if (within(source, destination)) throw new Error('无法把文件夹移入自身或下级文件夹。')
      if (await infoIfPresent(destination)) throw new Error('目标位置已有同名文件或文件夹。')
    }
    const isFile = (await lstat(source)).isFile()
    if (isFile && extensionOf(source) !== extensionOf(destination) &&
        this.files.some(f => same(f.path, source))) throw new Error('已打开或最近使用的文件应保留原扩展名。')
    if (isFile && !same(source, destination)) {
      // Publishing a link is exclusive even when an external program creates the name concurrently.
      try { await link(source, destination) } catch (error) {
        if (error.code === 'EEXIST') throw new Error('目标位置已有同名文件。')
        if (!['ENOSYS', 'ENOTSUP', 'EPERM', 'EXDEV'].includes(error.code)) throw error
        await copyFile(source, destination, constants.COPYFILE_EXCL)
      }
      try { await unlink(source) } catch (error) {
        // The move did not complete. Retain both files if either is currently locked.
        throw new Error('目标文件已创建，原文件未能移除。请刷新列表检查两个位置。', { cause: error })
      }
    } else await rename(source, destination)
    for (const file of this.files) {
      if (within(source, file.path)) file.path = join(destination, relative(source, file.path))
    }
    await this.persist()
    return this.row(destination)
  }

  async rename(path, name) {
    const source = await this.pathInRoot(path)
    return this.relocate(source, join(dirname(source), validName(name)))
  }

  async move(path, destinationDir) {
    const source = await this.pathInRoot(path)
    return this.relocate(source, join(await this.folder(destinationDir), basename(source)))
  }

  async trash(path) {
    const source = await this.pathInRoot(path)
    this.protect(source)
    await this.platform.trash(source)
    this.files = this.files.filter(f => !within(source, f.path))
    await this.persist()
    return true
  }

  recent() {
    return this.files.slice(0, 40).map(f => ({ ...f, name: basename(f.path), extension: extensionOf(f.path) }))
  }

  describe(ids) {
    if (!Array.isArray(ids) || ids.length > 2000) throw new Error('文件索引请求无效。')
    const wanted = new Set(ids)
    return this.files.filter(file => wanted.has(file.id)).map(file => ({
      ...file, name: basename(file.path), extension: extensionOf(file.path),
    }))
  }

  knownFile(id) {
    const file = this.files.find(f => f.id === id)
    if (!file) throw new Error('文件已移除或不在文件索引中，请另存为或重新打开。')
    return file
  }

  async remember(path, modifiedAt, revision, id = randomUUID()) {
    const prior = this.files.find(f => same(f.path, path))
    const file = { id: prior?.id ?? id, path, modifiedAt }
    this.files = [file, ...this.files.filter(f => f.id !== file.id)]
    await this.persist()
    return { ...file, name: basename(path), extension: extensionOf(path), revision }
  }

  async openPath(path) {
    this.protect(path)
    const extension = extensionOf(path)
    validateExtension(extension)
    const { bytes, modifiedAt } = await readBytes(path)
    // A PDF page stores its file binding. Its original bytes are read only by the viewer.
    const utf8Text = extension === 'txt' && isUtf8(bytes) &&
      (!bytes.subarray(0,1024).includes(0) || bytes.subarray(0,3).equals(Buffer.from([239,187,191])))
    const content = extension === 'pdf' ? null : utf8Text ? bytes.toString('utf8') :
      binary.has(extension) ? bytes.toString('base64') : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    return { ...await this.remember(path, modifiedAt, digest(bytes)), content, ...(utf8Text ? {textEncoding:'utf-8'} : {}) }
  }

  async read(path) { return this.openPath(await this.pathInRoot(path)) }
  async readRecent(id) { return this.openPath(this.knownFile(id).path) }
  async readPdf(id, revision) {
    const { path } = this.knownFile(id)
    this.protect(path)
    if (extensionOf(path) !== 'pdf') throw new Error('请选择 PDF 文件。')
    const { bytes } = await readBytes(path)
    if (digest(bytes) !== revision) throw new Error('PDF 原件已变化。请从文件中心重新打开。')
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  async copyPdf(id, revision, edited, purpose) {
    const file = this.knownFile(id)
    if (extensionOf(file.path) !== 'pdf') throw new Error('请选择 PDF 文件。')
    if (edited != null) {
      if (!(edited instanceof Uint8Array) || edited.byteLength > maxBytes || Buffer.from(edited.subarray(0,5)).toString('ascii') !== '%PDF-') {
        throw new Error('编辑后的 PDF 无效或超过 32 MiB。')
      }
    }
    const suffix = purpose === 'extract' ? '-选页.pdf' : purpose === 'append' ? '-合并.pdf' : '-副本.pdf'
    const target = await this.platform.chooseSave(basename(file.path, extname(file.path)) + suffix, 'pdf')
    if (!target) return null
    const path = join(await realpath(dirname(target)), basename(target))
    this.protect(path)
    if (extensionOf(path) !== 'pdf') throw new Error('请保留 .pdf 扩展名。')
    const original = await this.readPdf(id, revision)
    const bytes = edited ?? original
    await exclusiveWrite(path, bytes)
    return this.remember(path, (await stat(path)).mtime.toISOString(), edited == null ? revision : digest(bytes))
  }
  async chooseOpen(extension) {
    if (extension) validateExtension(extension)
    const path = await this.platform.chooseOpen(extension)
    if (!path) return null
    if (extension && extensionOf(path) !== extension) throw new Error('请选择 .' + extension + ' 文件。')
    return this.openPath(await realpath(path))
  }

  async readOfficeSource(id, revision) {
    const { path } = this.knownFile(id)
    this.protect(path)
    if (!['docx','xlsx','pptx'].includes(extensionOf(path))) throw new Error('请选择 Office Open XML 文件。')
    const { bytes } = await readBytes(path)
    if (digest(bytes) !== revision) throw new Error('磁盘原件已经变化，请重新打开后再替换。')
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  async saveOfficeCopy(id, revision, edited) {
    const { path:source } = this.knownFile(id)
    const ext = extensionOf(source)
    if (!['docx','xlsx','pptx'].includes(ext) || !(edited instanceof Uint8Array) || edited.length > maxBytes ||
        edited[0] !== 0x50 || edited[1] !== 0x4b) throw new Error('Office 副本内容或大小无效。')
    const target = await this.platform.chooseSave(basename(source, extname(source))+'-替换副本.'+ext, ext)
    if (!target) return null
    const path = join(await realpath(dirname(target)), basename(target))
    this.protect(path)
    if (extensionOf(path) !== ext || same(path,source)) throw new Error('请选择同格式的新文件名以保留原件。')
    await this.readOfficeSource(id, revision)
    await exclusiveWrite(path, edited)
    return this.remember(path,(await stat(path)).mtime.toISOString(),digest(edited))
  }

  async create(directory, name, content) {
    return this.save({ directory, name, content, extension: extensionOf(name) })
  }

  async exportBackup(id) {
    const file = this.knownFile(id)
    const suffix = extname(file.path)
    const backup = join(this.profile, 'file-backups', file.id + '.bak')
    if (!await infoIfPresent(backup)) throw new Error('这个文件还没有上次保存前的备份。')
    const { bytes } = await readBytes(backup)
    const target = await this.platform.chooseSave(basename(file.path, suffix) + '-上次保存前' + suffix, extensionOf(file.path))
    if (!target) return null
    const path = join(await realpath(dirname(target)), basename(target))
    this.protect(path)
    if (extensionOf(path) !== extensionOf(file.path)) throw new Error('请保留原文件的扩展名。')
    await exclusiveWrite(path, bytes)
    return { name: basename(path), path }
  }

  async save({ id, name, extension, content, revision, asNew = false, directory, preserveSource = false }) {
    validateExtension(extension)
    if (extension === 'pdf') throw new Error('PDF 阅读器保留原件，请使用另存副本。')
    validName(name)
    if (extensionOf(name) !== extension) throw new Error('文件名与保存格式不一致。')
    const bytes = encodeContent(content, extension)
    let path
    const inFolder = directory != null
    const bound = id && !asNew && !inFolder
    if (inFolder) path = join(await this.folder(directory), name)
    else if (bound) path = this.knownFile(id).path
    else {
      path = await this.platform.chooseSave(name, extension)
      if (!path) return null
      path = join(await realpath(dirname(path)), basename(path))
    }
    this.protect(path)
    if (preserveSource && id && same(this.knownFile(id).path, path)) throw new Error('转换编码请另选文件名，保留原件。')
    if (extensionOf(path) !== extension) throw new Error('所选文件的扩展名与保存格式不一致。')
    const info = await infoIfPresent(path)
    if (bound && !info) throw new Error('磁盘文件已移动或删除，请另存为。')
    if (inFolder && info) throw new Error('已有同名文件或文件夹。')
    const existing = this.files.find(f => same(f.path, path))
    const handleId = existing?.id ?? randomUUID()
    let backupPath
    if (info) {
      const { bytes: previous } = await readBytes(path)
      const previousRevision = digest(previous)
      if ((bound || (asNew && id === existing?.id && id != null)) && revision !== previousRevision) throw new Error('文件已被其他程序修改，请重新打开或另存为。')
      if (!previous.equals(bytes)) {
        const backupDir = join(this.profile, 'file-backups')
        backupPath = join(backupDir, handleId + '.bak')
        await mkdir(backupDir, { recursive: true })
        await writeAtomically(backupPath, previous)
        // Recheck after writing the backup and staging the replacement, just before renaming.
        const staged = join(dirname(path), '.yanye-' + randomUUID() + '.tmp')
        await exclusiveWrite(staged, bytes)
        try {
          if (digest((await readBytes(path)).bytes) !== previousRevision) throw new Error('文件已被其他程序修改，请重新打开或另存为。')
          await rename(staged, path)
        } finally { await unlink(staged).catch(() => {}) }
      }
    } else {
      await canonicalExisting(dirname(path))
      await exclusiveWrite(path, bytes)
    }
    return { ...await this.remember(path, (await stat(path)).mtime.toISOString(), digest(bytes), handleId), backupPath }
  }
}
