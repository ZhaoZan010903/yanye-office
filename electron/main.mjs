import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MAX_MARKDOWN_LENGTH, MAX_TITLE_LENGTH } from '../shared/workspace.mjs'
import { WorkspaceStore, writeAtomically } from './store.mjs'

const directory = fileURLToPath(new URL('../', import.meta.url))
const assets = join(directory, 'dist')
const startUrl = 'yanye://app/index.html'
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

app.setName('砚页')
app.setAppUserModelId('com.yanye.desktop')
app.enableSandbox()

const profile = process.env.YANYE_PROFILE
if (profile && !isAbsolute(profile)) throw new Error('YANYE_PROFILE must be an absolute path.')
const userData = profile || join(app.getPath('appData'), 'YanYe')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)

protocol.registerSchemesAsPrivileged([{ scheme: 'yanye', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const store = new WorkspaceStore(join(app.getPath('userData'), 'workspace.json'))
let window
let saveTimer
let closeTimer
let closing = false
let closeInProgress = false
let closeAllowed = false

function notifySave(state) {
  if (window && !window.isDestroyed()) window.webContents.send('workspace:save-result', state)
}

async function flush() {
  clearTimeout(saveTimer)
  const revision = await store.flush()
  notifySave({ state: 'saved', revision })
  return revision
}

function saveError(error) {
  const message = error instanceof Error ? error.message : String(error)
  notifySave({ state: 'error', message })
}

async function finishClose(snapshot) {
  if (!closing || closeInProgress) return
  closeInProgress = true
  clearTimeout(closeTimer)

  try {
    if (snapshot) store.stage(snapshot)
    await flush()
    closeAllowed = true
    window.close()
  } catch (error) {
    saveError(error)
    const result = await dialog.showMessageBox(window, {
      type: 'error',
      message: '工作区保存失败',
      detail: '可以留在应用中重试，或放弃这次未保存的编辑。',
      buttons: ['返回应用', '放弃改动并关闭'],
      defaultId: 0,
      cancelId: 0,
    })
    if (result.response === 1) {
      closeAllowed = true
      window.close()
    }
  } finally {
    closing = false
    closeInProgress = false
  }
}

function assertTrusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame?.url !== startUrl) {
    throw new Error('消息来自未知的窗口。')
  }
}

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrusted(event)
    return callback(...args)
  })
}

function markdownFilename(title) {
  const base = title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').trim().replace(/[. ]+$/u, '') || '未命名页面'
  const prefix = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(base) ? '_' : ''
  return `${prefix}${base}.md`
}

function registerHandlers() {
  handle('workspace:load', async () => ({ workspace: await store.load(), directory: dirname(store.filename) }))

  ipcMain.on('workspace:stage', (event, snapshot) => {
    try {
      assertTrusted(event)
      if (!store.stage(snapshot)) return
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => { flush().catch(saveError) }, 360)
    } catch (error) {
      saveError(error)
    }
  })

  handle('workspace:flush', async snapshot => {
    if (snapshot) store.stage(snapshot)
    return flush()
  })
  handle('workspace:finish-close', finishClose)
  handle('workspace:open-folder', () => shell.openPath(dirname(store.filename)))

  handle('markdown:import', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '导入 Markdown',
      filters: [{ name: 'Markdown 文档', extensions: ['md', 'markdown', 'mdown'] }],
      properties: ['openFile'],
    })
    if (result.canceled) return null

    const filename = result.filePaths[0]
    const info = await stat(filename)
    if (!info.isFile() || !/\.(?:md|markdown|mdown)$/iu.test(filename)) throw new Error('请选择 Markdown 文件。')
    if (info.size > MAX_MARKDOWN_LENGTH * 4) throw new Error('文件超过单页大小上限。')
    const markdown = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(filename))
    if (markdown.length > MAX_MARKDOWN_LENGTH) throw new Error('文件超过单页大小上限。')
    return { title: basename(filename, extname(filename)).slice(0, MAX_TITLE_LENGTH), markdown }
  })

  handle('markdown:export', async (title, markdown) => {
    if (typeof title !== 'string' || title.length > MAX_TITLE_LENGTH || typeof markdown !== 'string' || markdown.length > MAX_MARKDOWN_LENGTH) {
      throw new Error('页面内容超过导出限制。')
    }
    const result = await dialog.showSaveDialog(window, {
      title: '导出 Markdown',
      defaultPath: markdownFilename(title),
      filters: [{ name: 'Markdown 文档', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return false
    await writeAtomically(result.filePath, markdown)
    return true
  })

  handle('open-link', async href => {
    if (typeof href !== 'string' || href.length > 8192) return
    const url = new URL(href)
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) {
      await shell.openExternal(url.href)
    }
  })
}

function serveAssets(request) {
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.hostname !== 'app') return new Response(null, { status: 404 })

  const target = resolve(assets, `.${decodeURIComponent(url.pathname)}`)
  const resource = relative(assets, target)
  if (resource !== 'index.html' && !resource.startsWith(`assets${sep}`)) return new Response(null, { status: 404 })

  return net.fetch(pathToFileURL(target).href).then(response => {
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', csp)
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(response.body, { status: response.status, headers })
  })
}

function createWindow() {
  window = new BrowserWindow({
    title: '砚页',
    width: 1376,
    height: 900,
    minWidth: 760,
    minHeight: 530,
    backgroundColor: '#f8f6ee',
    icon: join(directory, 'assets', 'yanye.png'),
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f8f6ee', symbolColor: '#34483a', height: 43 },
    webPreferences: {
      preload: join(directory, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.webContents.on('context-menu', (_event, details) => {
    if (!details.isEditable && !details.selectionText) return
    const items = details.isEditable
      ? [
          { role: 'undo', label: '撤销', enabled: details.editFlags.canUndo },
          { type: 'separator' },
          { role: 'cut', label: '剪切', enabled: details.editFlags.canCut },
          { role: 'copy', label: '复制', enabled: details.editFlags.canCopy },
          { role: 'paste', label: '粘贴', enabled: details.editFlags.canPaste },
          { role: 'selectAll', label: '全选' },
        ]
      : [{ role: 'copy', label: '复制' }]
    Menu.buildFromTemplate(items).popup({ window })
  })

  window.once('ready-to-show', () => window.show())
  window.on('close', event => {
    if (closeAllowed) return
    event.preventDefault()
    if (closing) return
    closing = true
    closeTimer = setTimeout(() => { void finishClose() }, 1_500)
    window.webContents.send('workspace:close-request')
  })
  window.on('closed', () => { window = undefined })
  window.loadURL(startUrl).catch(error => {
    dialog.showErrorBox('无法启动砚页', error.message)
    closeAllowed = true
    app.quit()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
    protocol.handle('yanye', serveAssets)
    registerHandlers()
    createWindow()
  })
}

app.on('window-all-closed', () => app.quit())
