const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const noteKinds={footnote:'脚注',endnote:'尾注'}
const elements=(el,name)=>[...(el?.getElementsByTagNameNS(W,name) || [])]
const attr=(el,key)=>el?.getAttributeNS(W,key)
const noteElements=new Set(('p pPr pStyle spacing ind jc keepNext keepLines widowControl contextualSpacing tabs tab r rPr rStyle rFonts b bCs i iCs sz szCs color u strike vertAlign highlight lang rtl cs noProof t footnoteRef endnoteRef br cr lastRenderedPageBreak').split(' '))

function noteText(note) {
  return elements(note,'p').map(p=>elements(p,'*').map(el=>{
    if(el.localName==='t') return el.textContent
    if(el.localName==='tab' && el.parentElement.localName==='r') return '\t'
    if(el.localName==='br' || el.localName==='cr') return '\n'
    return ''
  }).join('')).join('\n')
}
function copyElement(el) {
  const attributes=Object.fromEntries([...el.attributes].filter(a=>a.namespaceURI===W).map(a=>[a.localName,a.value]))
  return {tag:el.localName,attributes,...(el.localName==='t'?{text:el.textContent}:{children:[...el.children].map(copyElement)})}
}
function emitElement(node,escape,depth=0) {
  if(!node || !noteElements.has(node.tag) || depth>12) throw Error('注释正文含有无法写回的格式。')
  const attrs=Object.entries(node.attributes || {}).filter(([name])=>/^[A-Za-z][A-Za-z0-9]*$/.test(name)).map(([k,v])=>' w:'+k+'="'+escape(v)+'"').join('')
  return '<w:'+node.tag+attrs+(node.tag==='t'?' xml:space="preserve">'+escape(node.text):'>'+(node.children || []).map(n=>emitElement(n,escape,depth+1)).join(''))+'</w:'+node.tag+'>'
}
export async function readNoteParts(targets,xml) {
  const notes=new Map()
  let protectedNotes=false
  for(const kind of Object.keys(noteKinds)) {
    const rel=[...targets.values()].find(r=>r.getAttribute('Type')===R+'/'+kind+'s' && r.getAttribute('TargetMode')!=='External')
    if(!rel) continue
    const url=new URL(rel.getAttribute('Target'),'https://local.invalid/word/document.xml')
    const root=url.origin==='https://local.invalid' && await xml(decodeURIComponent(url.pathname.slice(1)))
    for(const note of elements(root,kind)) {
      if(attr(note,'type') && attr(note,'type')!=='normal') continue
      const text=noteText(note)
      const supported=[...note.getElementsByTagName('*')].every(el=>el.namespaceURI===W && noteElements.has(el.localName))
      if(!supported) protectedNotes=true
      const native=supported?[...note.children].map(copyElement):null
      notes.set(kind+':'+attr(note,'id'),{kind,text,native})
    }
  }
  return {notes,protectedNotes}
}
export function createNoteParts(escape) {
  const notes={footnote:[],endnote:[]}
  function reference(attrs) {
    if(!Object.hasOwn(notes,attrs.kind)) throw Error('注释类型无效。')
    const kind=attrs.kind,id=notes[kind].push(attrs)
    return '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:'+kind+'Reference w:id="'+id+'"/></w:r>'
  }
  function write(zip,parts,relations,xml) {
    for(const [kind,items] of Object.entries(notes)) {
      if(!items.length) continue
      const name=kind+'s'
      let body=['separator','continuationSeparator'].map((type,i)=>'<w:'+kind+' w:type="'+type+'" w:id="'+(i-1)+'"><w:p><w:r><w:'+type+'/></w:r></w:p></w:'+kind+'>').join('')
      for(const [i,item] of items.entries()) {
        const marker='<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:'+kind+'Ref/></w:r>'
        const paragraphs=item.native ? item.native.map(n=>emitElement(n,escape)).join('') : String(item.text || '').split('\n').map((line,index)=>'<w:p>'+(index===0?marker:'')+'<w:r>'+line.split('\t').map(t=>'<w:t xml:space="preserve">'+escape(t)+'</w:t>').join('<w:tab/>')+'</w:r></w:p>').join('')
        body+='<w:'+kind+' w:id="'+(i+1)+'">'+paragraphs+'</w:'+kind+'>'
      }
      zip.file('word/'+name+'.xml',xml+'<w:'+name+' xmlns:w="'+W+'">'+body+'</w:'+name+'>')
      parts.push([name,name]);relations.push(['r'+name,name,name+'.xml'])
    }
  }
  return {reference,write}
}

export function tocLevels(value) { return Math.min(6,Math.max(1,parseInt(value,10) || 3)) }
export function tocXml(attrs,escape,bookmark) {
  const levels=tocLevels(attrs.levels)
  const lines=Array.isArray(attrs.entries) && attrs.entries.length?attrs.entries:[{text:'',level:1}]
  return lines.map(({text,level},i)=>{
    const begin='<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-'+levels+'" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    const end='<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    const before=i===0?(attrs.before || []).map(bookmark).join(''):''
    const after=i===lines.length-1?(attrs.after || []).map(bookmark).join(''):''
    return '<w:p><w:pPr><w:ind w:left="'+((tocLevels(level)-1)*240)+'"/></w:pPr>'+before+(i===0?begin:'')+'<w:r><w:t xml:space="preserve">'+escape(text)+'</w:t></w:r>'+(i===lines.length-1?end:'')+after+'</w:p>'
  }).join('')
}
// Office can split a TOC's cached result across paragraphs and nest PAGEREF fields in each entry.
export function readToc(paragraphs,start) {
  const paragraph=paragraphs[start]
  if(paragraph.localName!=='p') return
  let code=''
  // Nested page-reference fields belong to the result, not the TOC instruction.
  for(const el of elements(paragraph,'*')) {
    if(el.localName==='fldChar' && attr(el,'fldCharType')==='separate') break
    if(el.localName==='instrText') code+=el.textContent
  }
  const simple=elements(paragraph,'fldSimple').find(n=>/^\s*TOC\b/i.test(attr(n,'instr')))
  const instruction=simple?attr(simple,'instr'):code
  if(!/^\s*TOC\b/i.test(instruction)) return
  const levels=tocLevels(instruction.match(/\\o\s+"1-(\d+)"/i)?.[1])
  const unsupported=!/^\s*TOC\s+(?:\\(?:o\s+"1-[1-6]"|[hzu])\s*)+$/i.test(instruction)
  let balance=0,seen=false
  const entries=[]
  for(let i=start;i<paragraphs.length && paragraphs[i].localName==='p';i++) {
    const p=paragraphs[i]
    for(const f of elements(p,'fldChar')) {
      const type=attr(f,'fldCharType')
      if(type==='begin') {balance++;seen=true}
      if(type==='end') balance--
    }
    const runs=elements(p,'t')
    const line=runs.map(n=>n.textContent).join('')
    const tabs=elements(p,'tab').filter(n=>n.parentElement?.localName==='r')
    let text=line
    if(tabs.length) {const tab=tabs.at(-1);text=runs.filter(n=>n.compareDocumentPosition(tab)&4).map(n=>n.textContent).join('')}
    const style=attr(elements(p,'pStyle')[0],'val') || ''
    const indent=Number(attr(elements(p,'ind')[0],'left')) || 0
    if(text) entries.push({text,level:tocLevels(style.match(/(\d+)$/)?.[1] || (1+Math.round(indent/240)))})
    if(simple || (seen && balance===0)) {
      const first=simple || elements(paragraph,'fldChar')[0]
      const last=simple || elements(p,'fldChar').at(-1)
      const sharesParagraph=elements(paragraph,'t').some(n=>(n.compareDocumentPosition(first)&4)!==0) ||
        elements(p,'t').some(n=>(n.compareDocumentPosition(last)&2)!==0 && !simple?.contains(n))
      return {end:i,first,last,protected:unsupported || sharesParagraph,node:{type:'wordToc',attrs:{levels,entries}}}
    }
  }
}
