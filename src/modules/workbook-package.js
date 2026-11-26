import { SaxesParser } from 'saxes'

export const mainNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
export const relNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const packageNS = 'http://schemas.openxmlformats.org/package/2006/relationships'
export const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
export const escapeXml = value => String(value).replace(/[<>&"']/g, ch => ({'<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;'}[ch]))
export function scan(xml, open, close, text) {
  const parser = new SaxesParser({xmlns:true})
  parser.on('doctype', () => { throw new Error('工作簿 XML 声明了不支持的 DTD。') })
  parser.on('opentag', node => open(node, parser.position))
  if (close) parser.on('closetag', node => close(node, parser.position))
  if (text) parser.on('text', text)
  parser.write(xml).close()
}
export const attr = (node, key) => node.attributes[key]?.value
export const relId = node => Object.values(node.attributes).find(a => a.local==='id' && a.uri===relNS)?.value
export function relationshipPath(part) {
  const pieces=part.split('/'), filename=pieces.pop()
  return [...pieces,'_rels',filename+'.rels'].join('/')
}
export async function relations(zip, part) {
  const file=zip.file(relationshipPath(part)), result=[]
  if (file) scan(await file.async('string'), node => {
    if (node.uri!==packageNS || node.local!=='Relationship' || attr(node,'TargetMode')==='External') return
    const target=new URL(attr(node,'Target'),'https://book.invalid/'+part)
    if (target.origin==='https://book.invalid') result.push({id:attr(node,'Id'),type:attr(node,'Type'),part:decodeURIComponent(target.pathname.slice(1))})
  })
  return result
}
export async function worksheets(zip) {
  const parts=await relations(zip,'xl/workbook.xml'), result=[]
  scan(await zip.file('xl/workbook.xml').async('string'), node => {
    if (node.uri!==mainNS || node.local!=='sheet') return
    const part=parts.find(p=>p.id===relId(node) && p.type===relNS+'/worksheet')?.part
    if (part) result.push({name:attr(node,'name'),part})
  })
  return result
}
