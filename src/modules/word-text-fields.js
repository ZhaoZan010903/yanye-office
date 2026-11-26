const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const ordinary=/^\s*(?:DATE|TIME|CREATEDATE|SAVEDATE|PRINTDATE|PAGE|NUMPAGES|SECTION|SECTIONPAGES|NUMWORDS|NUMCHARS|AUTHOR|TITLE|SUBJECT|KEYWORDS|LASTSAVEDBY|REVNUM|FILENAME|USERNAME|USERINITIALS|DOCPROPERTY)(?:\s|$)/i
const propertyTags=new Set('rPr rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath'.split(' '))
const atomValues={tab:'\t',br:'\n',cr:'\n',noBreakHyphen:'‑',softHyphen:'\u00ad'}
const has=(object,key)=>Object.hasOwn(object,key)
const attr=(el,key)=>el?.getAttributeNS(W,key)
function cachedProperties(el) {
  if(!el)return null
  if(!propertyTags.has(el.localName) || el.namespaceURI!==W)return false
  const attributes={}
  for(const a of el.attributes) {
    if(a.namespaceURI!==W)return false
    attributes[a.localName]=a.value
  }
  const children=[...el.children].map(cachedProperties)
  return children.includes(false)?false:{tag:el.localName,attributes,children}
}
function serializeProperties(el,escape,depth=0) {
  if(!el)return ''
  if(!propertyTags.has(el.tag) || depth>4)throw Error('域结果含有无法保存的字体属性。')
  const attrs=Object.entries(el.attributes || {}).filter(([k])=>/^[A-Za-z][A-Za-z0-9]*$/.test(k)).map(([k,v])=>' w:'+k+'="'+escape(v)+'"').join('')
  const inner=(el.children || []).map(c=>serializeProperties(c,escape,depth+1)).join('')
  return '<w:'+el.tag+attrs+(inner?'>'+inner+'</w:'+el.tag+'>':'/>')
}
export function storedTextField(code,leaves,begin) {
  if(!ordinary.test(code))return null
  const runs=[]
  for(const leaf of leaves) {
    const name=leaf.localName
    if(name!=='t' && !has(atomValues,name))continue
    let run=leaf.parentElement
    while(run && run.localName!=='r')run=run.parentElement
    const properties=cachedProperties([...run?.children || []].find(el=>el.localName==='rPr'))
    if(properties===false)return null
    runs.push({kind:name,text:name==='t'?leaf.textContent:atomValues[name],properties})
  }
  return {type:'wordTextField',attrs:{code,runs,text:runs.map(r=>r.text).join(''),lock:attr(begin,'fldLock'),dirty:attr(begin,'dirty')}}
}
export function storedFieldXml(attrs,escape) {
  if(!ordinary.test(attrs.code))throw Error('该文字域指令需要保留原版式。')
  const flags=[['fldLock',attrs.lock],['dirty',attrs.dirty]].filter(([,v])=>v!=null).map(([k,v])=>' w:'+k+'="'+escape(v)+'"').join('')
  const result=(attrs.runs || []).map(run=>{
    const content=run.kind==='t'?'<w:t xml:space="preserve">'+escape(run.text)+'</w:t>':has(atomValues,run.kind)?'<w:'+run.kind+'/>':''
    return '<w:r>'+serializeProperties(run.properties,escape)+content+'</w:r>'
  }).join('')
  return '<w:r><w:fldChar w:fldCharType="begin"'+flags+'/></w:r><w:r><w:instrText xml:space="preserve">'+escape(attrs.code)+'</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'+result+'<w:r><w:fldChar w:fldCharType="end"/></w:r>'
}
