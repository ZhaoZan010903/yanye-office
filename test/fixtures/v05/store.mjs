import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { assertWorkspace, initialWorkspace, MAX_WORKSPACE_BYTES } from '../../../shared/workspace.mjs'

export async function writeAtomically(filename, text) {
  const temporaryFile = `${filename}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporaryFile, 'wx')
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryFile, filename)
  } finally {
    await unlink(temporaryFile).catch(() => {})
  }
}

// A renderer can submit another edit while the storage process is reporting
// dirty disk bindings. Only close against a stable file queue and revision.
export async function settleWorkspaceForClose(library, store, flush) {
  for (;;) {
    const fileQueue = library.idle()
    await fileQueue
    await flush()
    const dirty = await store.dirtyFiles()
    if (!store.hasPending && library.idle() === fileQueue) return dirty
  }
}

export class WorkspaceStore {
  #current = null
  #persisted = null
  #writing = Promise.resolve()

  constructor(filename) {
    this.filename = filename
  }

  async load() {
    if (this.#current) return this.#current

    try {
      if ((await stat(this.filename)).size > MAX_WORKSPACE_BYTES) throw new Error('工作区文件超过大小上限。')
      this.#current = assertWorkspace(JSON.parse(await readFile(this.filename, 'utf8')))
      this.#persisted = this.#current
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      this.#current = initialWorkspace()
      try {
        await this.flush()
      } catch (writeError) {
        this.#current = null
        throw writeError
      }
    }
    return this.#current
  }

  stage(snapshot) {
    if (!this.#current || snapshot?.revision <= this.#current.revision) return false
    this.#current = assertWorkspace(snapshot)
    return true
  }

  flush() {
    const flush = this.#writing.catch(() => {}).then(async () => {
      while (this.#current && this.#current !== this.#persisted) {
        const snapshot = this.#current
        const document = JSON.stringify(snapshot)
        if (Buffer.byteLength(document) > MAX_WORKSPACE_BYTES) throw new Error('工作区超过大小上限。请先导出大页面。')
        await mkdir(dirname(this.filename), { recursive: true })
        await writeAtomically(this.filename, document)
        this.#persisted = snapshot
      }
      return this.#persisted?.revision ?? 0
    })
    this.#writing = flush
    return flush
  }
}
