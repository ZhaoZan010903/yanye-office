import { WorkspaceDatabase } from './workspace-database.mjs'
import { visiblePages } from '../shared/workspace.mjs'

let store
process.parentPort.on('message', ({ data: { id, action, payload } }) => {
  try {
    store ??= new WorkspaceDatabase(process.argv[2])
    let result
    switch (action) {
      case 'load': result = store.workspace; break
      case 'commit': result = store.commit(payload); break
      case 'dirty':
        result = visiblePages(store.workspace.pages).filter(page => page.disk?.dirty && !page.disk.closeAcknowledged)
          .map(page => page.disk.name)
        break
      default: throw new Error('未知的工作区请求。')
    }
    process.parentPort.postMessage({ id, result })
  } catch (error) {
    process.parentPort.postMessage({ id, error: error.message })
  }
})
