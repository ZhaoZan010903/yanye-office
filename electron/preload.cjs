const { contextBridge, ipcRenderer } = require('electron')

function listen(channel, handler) {
  const listener = (_event, value) => handler(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('yanye', {
  library: Object.fromEntries(['state','chooseRoot','list','mkdir','rename','move','trash','read','chooseOpen','recent','describe','readRecent','save','create','exportBackup','readPdf','copyPdf','readOfficeSource','saveOfficeCopy']
    .map(method => [method, (...args) => ipcRenderer.invoke('library:' + method, ...args)])),
  importFile: extension => ipcRenderer.invoke('office:import', extension),
  printPdf: name => ipcRenderer.invoke('office:print-pdf', name),
  exportFile: (filename, content) => ipcRenderer.invoke('office:export', filename, content),
  load: () => ipcRenderer.invoke('workspace:load'),
  stage: delta => ipcRenderer.send('workspace:stage', delta),
  save: () => ipcRenderer.invoke('workspace:flush'),
  openFolder: () => ipcRenderer.invoke('workspace:open-folder'),
  onSave: handler => listen('workspace:save-result', handler),
  onCloseRequest: handler => listen('workspace:close-request', handler),
  finishClose: () => ipcRenderer.invoke('workspace:finish-close'),
  importMarkdown: () => ipcRenderer.invoke('markdown:import'),
  exportMarkdown: (title, markdown) => ipcRenderer.invoke('markdown:export', title, markdown),
  openLink: href => ipcRenderer.invoke('open-link', href),
})
