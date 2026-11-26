import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { initialWorkspace } from '../../shared/workspace.mjs'
import { base64, base64Bytes } from '../modules/plain-text.js'
import { StagedWrites } from './staged-writes'

type SaveResult = { state: 'saved'; revision: number } | { state: 'error'; message: string }
type Listener<T> = (value: T) => void
type Workspace = ReturnType<typeof initialWorkspace>

function command<T>(operation: string, ...args: unknown[]): Promise<T> {
  return invoke<T>('desktop_call', { operation, args }).catch((reason: unknown) => {
    throw reason instanceof Error ? reason : new Error(String(reason))
  })
}

function events<T>() {
  const handlers = new Set<Listener<T>>()
  return {
    subscribe(handler: Listener<T>) {
      handlers.add(handler)
      return () => { handlers.delete(handler) }
    },
    publish(value: T) { for (const handler of handlers) handler(value) },
  }
}

const libraryOperations = ['state', 'chooseRoot', 'list', 'mkdir', 'rename', 'move', 'trash',
  'read', 'chooseOpen', 'recent', 'describe', 'readRecent', 'save', 'create', 'exportBackup'] as const
type LibraryOperation = typeof libraryOperations[number]
type LibraryMethods = Record<LibraryOperation, (...args: unknown[]) => Promise<unknown>>

async function readBytes(operation: string, id: string, revision: string): Promise<Uint8Array> {
  const { __bytes } = await command<{ __bytes: string }>('library:' + operation, id, revision)
  return base64Bytes(__bytes)
}

function copyFile(operation: string, id: string, revision: string, bytes?: Uint8Array, purpose?: string) {
  return command('library:' + operation, id, revision, bytes ? { __bytes: base64(bytes) } : null, purpose)
}

async function createDesktop() {
  const saved = events<SaveResult>()
  const close = events<void>()
  const opened = events<void>()
  const writes = new StagedWrites<unknown>(delta => command('workspace:stage', delta))
  await Promise.all([
    listen<SaveResult>('yanye-save', event => saved.publish(event.payload)),
    listen('yanye-close-request', () => close.publish()),
    listen('yanye-files', () => opened.publish()),
  ])
  const methods = Object.fromEntries(libraryOperations.map(name =>
    [name, (...args: unknown[]) => command('library:' + name, ...args)])) as LibraryMethods
  return {
    library: {
      ...methods,
      markdownResource: (id: string, ref: string) => command<{ mime: string; data: string }>('library:markdownResource', id, ref),
      markdownLink: (id: string, ref: string) => command('library:markdownLink', id, ref),
      readPdf: (id: string, revision: string) => readBytes('readPdf', id, revision),
      readOfficeSource: (id: string, revision: string) => readBytes('readOfficeSource', id, revision),
      pinWorkbookBase: (id: string, revision: string) => command('library:pinWorkbookBase',id,revision),
      readWorkbookBase: (id: string, revision: string) => readBytes('readWorkbookBase',id,revision),
      copyPdf: (id: string, revision: string, bytes?: Uint8Array, purpose?: string) => copyFile('copyPdf', id, revision, bytes, purpose),
      saveOfficeCopy: (id: string, revision: string, bytes: Uint8Array) => copyFile('saveOfficeCopy', id, revision, bytes),
    },
    load: () => command<{ workspace: Workspace; directory: string }>('workspace:load', initialWorkspace()),
    stage(delta: unknown) {
      void writes.stage(delta).catch((error: unknown) => saved.publish({ state: 'error', message: String(error) }))
    },
    async save() { await writes.drain(); return command('workspace:flush') },
    async finishClose() { await writes.drain(); return command('workspace:finish-close') },
    onSave: saved.subscribe,
    onCloseRequest: close.subscribe,
    onLaunchFiles: opened.subscribe,
    nextLaunchFile: () => command('library:next-launch-file'),
    openFolder: () => command('workspace:open-folder'),
    openLink: (url: string) => command('open-link', url),
    importFile: (extension: string) => command('office:import', extension),
    exportFile: (name: string, content: string) => command('office:export', name, content),
    printPdf: (name: string, size: { widthMm: number; heightMm: number }) => command('office:print-pdf', name, size),
    importMarkdown: () => command('markdown:import'),
    exportMarkdown: (title: string, markdown: string) => command('markdown:export', title, markdown),
  }
}

declare global {
  interface Window { yanye?: Awaited<ReturnType<typeof createDesktop>> }
}

export async function installDesktop() {
  if (isTauri()) window.yanye = await createDesktop()
}
