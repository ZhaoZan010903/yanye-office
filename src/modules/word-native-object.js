const base='http://schemas.openxmlformats.org/'
export const namespaces={
  w:base+'wordprocessingml/2006/main', m:base+'officeDocument/2006/math', a:base+'drawingml/2006/main',
  wp:base+'drawingml/2006/wordprocessingDrawing',wps:'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  wp14:'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing',a14:'http://schemas.microsoft.com/office/drawing/2010/main',
  w14:'http://schemas.microsoft.com/office/word/2010/wordml',w15:'http://schemas.microsoft.com/office/word/2012/wordml',
  w16cid:'http://schemas.microsoft.com/office/word/2016/wordml/cid',xml:'http://www.w3.org/XML/1998/namespace',
}
const prefixes=new Map(Object.entries(namespaces).map(([prefix,ns])=>[ns,prefix]))
const namePattern=/^(?:(?:w|m|a|wp|wps|a14|wp14|w14|w15|w16cid|xml):)?[A-Za-z_][A-Za-z0-9_.-]*$/
export const escapeXml=v=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')

// Keep Office formatting at native precision. Package relationships are handled by
// their owning parts, so a self-contained object cannot carry an external resource.
export function copyOfficeElement(el,depth=0) {
  const prefix=prefixes.get(el.namespaceURI)
  if(!prefix || depth>64)throw Error('此对象有无法独立保存的扩展内容。')
  const attrs={}
  for(const a of el.attributes) {
    if(a.namespaceURI==='http://www.w3.org/2000/xmlns/')continue
    const ns=a.namespaceURI && prefixes.get(a.namespaceURI)
    if(a.namespaceURI && !ns)throw Error('此对象含有外部引用或扩展属性。')
    attrs[(ns?ns+':':'')+a.localName]=a.value
  }
  return {tag:prefix+':'+el.localName,attrs,children:[...el.childNodes].flatMap(node=>
    node.nodeType===1?[copyOfficeElement(node,depth+1)]:node.nodeType===3?[node.nodeValue]:[])}
}
export function emitOffice(node,depth=0) {
  if(typeof node==='string')return escapeXml(node)
  if(depth>64 || !node || !namePattern.test(node.tag))throw Error('Office 对象格式无效。')
  const at=Object.entries(node.attrs||{}).map(([k,v])=>{
    if(!namePattern.test(k))throw Error('Office 对象属性无效。')
    return ' '+k+'="'+escapeXml(v)+'"'
  }).join('')
  return '<'+node.tag+at+(node.children?.length?'>'+node.children.map(c=>emitOffice(c,depth+1)).join('')+'</'+node.tag+'>':'/>')
}
export const elem=(tag,attrs={},children=[])=>({tag,attrs,children})
export function elements(node,tag,found=[]) {
  if(node?.tag===tag)found.push(node)
  for(const child of node?.children||[])if(typeof child==='object')elements(child,tag,found)
  return found
}
export const first=(node,tag)=>elements(node,tag)[0]
export const textOf=node=>(node?.children||[]).map(c=>typeof c==='string'?c:textOf(c)).join('')
export const declarations=Object.entries(namespaces).filter(([k])=>k!=='xml').map(([p,n])=>' xmlns:'+p+'="'+n+'"').join('')
