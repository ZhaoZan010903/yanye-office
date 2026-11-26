export const conversionTargets = Object.freeze({
  doc: 'docx', rtf: 'docx', odt: 'docx', xls: 'xlsx', ods: 'xlsx', ppt: 'pptx', odp: 'pptx',
})
export const diskExtensions = new Set(['docx','xlsx','xlsm','pptx','md','pdf','txt',...Object.keys(conversionTargets)])
export const editorExtension = extension => conversionTargets[extension] || extension
