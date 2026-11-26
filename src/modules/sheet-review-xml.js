import { attr, escapeXml, mainNS, relations, relNS, scan } from './workbook-package.js'
import { LIMITS, location, parseRange } from './spreadsheet.js'
import { absoluteArea } from './sheet-page.js'

export function readPrintAreas(xml) {
  const areas = new Map()
  let index, formula
  scan(xml,node=>{
    if (node.local==='definedName' && node.uri===mainNS && attr(node,'name')==='_xlnm.Print_Area') {
      index=Number(attr(node,'localSheetId')); formula=''
    }
  },node=>{
    if (node.local!=='definedName' || formula===undefined) return
    const refs = [...formula.matchAll(/(?:'(?:[^']|'')*'|[^!,]+)!([\w$:]+)(?:,|$)/g)]
      .map(match=>parseRange(match[1])).filter(Boolean)
    if (refs.length) areas.set(index,[...(areas.get(index) || []), ...refs])
    formula=undefined
  },value=>{if (formula!==undefined) formula+=value})
  return areas
}

// ExcelJS associates notes only with XML cell elements. Native Office can put a
// note on an otherwise absent cell. Read authors and addresses from the note part.
export async function readCellNotes(zip, path) {
  const rel = (await relations(zip,path)).find(link => link.type === relNS+'/comments')
  const part = rel && zip.file(rel.part)
  if (!part) return
  const authors = [], notes = {}
  let author, entry, readingText = false
  scan(await part.async('string'), node => {
    if (node.uri !== mainNS) return
    if (node.local === 'author') author = ''
    if (node.local === 'comment') {
      const ref = attr(node,'ref'), p = location(ref)
      if (!p || p.row >= LIMITS.rows || p.col >= LIMITS.cols) throw Error('批注位置超出支持的行列数。')
      entry = {ref, author:authors[Number(attr(node,'authorId'))] ?? '', text:''}
    }
    if (node.local === 't' && entry) readingText = true
  }, node => {
    if (node.uri !== mainNS) return
    if (node.local === 'author') { authors.push(author); author = undefined }
    if (node.local === 't') readingText = false
    if (node.local === 'comment' && entry) {
      notes[entry.ref] = {author:entry.author,text:entry.text}
      entry = undefined
    }
  }, value => {
    if (author !== undefined) author += value
    if (readingText && entry) entry.text += value
  })
  return Object.keys(notes).length ? notes : undefined
}

export async function writeNoteAuthors(zip, path, notes) {
  const link = (await relations(zip,path)).find(rel => rel.type === relNS+'/comments')
  if (!link) return
  const authors = [...new Set(Object.values(notes).map(note => note.author))]
  const xml = await zip.file(link.part).async('string')
  const output = xml.replace(/<authors>[\s\S]*?<\/authors>/, () =>
    '<authors>'+authors.map(author=>'<author>'+escapeXml(author)+'</author>').join('')+'</authors>')
    .replace(/<comment ref="([A-Z]+\d+)" authorId="0">/g, (tag, ref) =>
      notes[ref] ? '<comment ref="'+ref+'" authorId="'+authors.indexOf(notes[ref].author)+'">' : tag)
  zip.file(link.part,output)
}

// Use one sheet-local defined name per setting, including multi-area ranges.
// Absolute row and column references survive new rows and apostrophes in names.
export async function writePrintNames(zip,sheets) {
  const names = []
  for (const [index,sheet] of sheets.entries()) {
    const page = sheet.pageSetup
    if (!page) continue
    const qualifier = "'"+sheet.name.replace(/'/g,"''")+"'!"
    const add = (key,refs) => {
      if (refs.length) names.push('<definedName name="_xlnm.'+key+'" localSheetId="'+index+'">'+
        escapeXml(refs.map(ref=>qualifier+ref).join(','))+'</definedName>')
    }
    add('Print_Area',(page.areas || []).map(absoluteArea))
    const titles = [page.printTitlesColumn,page.printTitlesRow].filter(Boolean)
    add('Print_Titles',titles.map(range=>range.split(':').map(s=>'$'+s).join(':')))
  }
  if (!names.length) return
  const path='xl/workbook.xml', xml=await zip.file(path).async('string')
  zip.file(path,xml.includes('</definedNames>') ? xml.replace('</definedNames>',()=>names.join('')+'</definedNames>') :
    xml.replace(/<calcPr\b|<\/workbook>/,tag=>'<definedNames>'+names.join('')+'</definedNames>'+tag))
}
