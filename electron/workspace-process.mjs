import { utilityProcess } from 'electron'
import { fileURLToPath } from 'node:url'

const workerPath = fileURLToPath(new URL('./workspace-worker.mjs', import.meta.url))

class WorkerExited extends Error {}

// The main process retains each unacknowledged batch. After a worker exit the
// replacement can replay it even when COMMIT succeeded just before the exit.
export class WorkspaceProcess {
  constructor(profile) {
    this.profile = profile
    this.pending = []
    this.writing = Promise.resolve()
    this.revision = 0
    this.sequence = 0
  }

  connect() {
    if (this.worker) return this.worker
    const requests = new Map()
    const child = utilityProcess.fork(workerPath, [this.profile], { serviceName: 'YanYe local storage' })
    const worker = { child, requests }
    this.worker = worker
    child.on('message', ({ id, result, error }) => {
      const request = requests.get(id)
      if (!request) return
      requests.delete(id)
      if (error !== undefined) request.reject(new Error(error))
      else request.resolve(result)
    })
    child.once('exit', () => {
      if (this.worker === worker) this.worker = undefined
      for (const request of requests.values()) request.reject(new WorkerExited('本地存储进程退出。'))
      requests.clear()
    })
    return worker
  }

  async request(action, payload) {
    for (let attempt = 0; ; attempt++) {
      const { child, requests } = this.connect()
      const id = ++this.sequence
      try {
        return await new Promise((resolve, reject) => {
          requests.set(id, { resolve, reject })
          try { child.postMessage({ id, action, payload }) } catch (error) { requests.delete(id); reject(error) }
        })
      } catch (error) {
        if (!(error instanceof WorkerExited) || attempt > 0) throw error
      }
    }
  }

  async load() {
    await this.flush()
    const workspace = await this.request('load')
    this.revision = workspace.revision
    return workspace
  }

  stage(delta) {
    this.pending.push(delta)
  }

  get hasPending() { return this.pending.length !== 0 }

  flush() {
    const writing = this.writing.catch(() => {}).then(async () => {
      const batch = this.pending.slice()
      if (batch.length) {
        this.revision = await this.request('commit', batch)
        this.pending.splice(0, batch.length)
      }
      return this.revision
    })
    this.writing = writing
    return writing
  }

  dirtyFiles() { return this.request('dirty') }
  dispose() { this.worker?.child.kill() }
}
