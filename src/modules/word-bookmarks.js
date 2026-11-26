import {storedTextField} from './word-text-fields.js'
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const elements=(el,name)=>[...el.getElementsByTagNameNS(W,name)]
const attr=(el,key)=>el.getAttributeNS(W,key)
export const validBookmark=name=>typeof name==='string' && /^[\p{L}_][\p{L}\p{M}\p{N}_]{0,39}$/u.test(name)

export function bookmarkNames(body) {
  const names=new Map()
  let protectedFields=false
  for(const el of elements(body,'bookmarkStart')) {
    const id=attr(el,'id'),name=attr(el,'name')
    if(!id || !validBookmark(name) || names.has(id) || attr(el,'colFirst')!==null || attr(el,'colLast')!==null)protectedFields=true
    names.set(id,name)
  }
  return {names,protectedFields}
}
export function bookmarkAnchor(el,index) {
  const id=attr(el,'id'),name=index.names.get(id),side=el.localName==='bookmarkStart'?'start':'end'
  if(!name){index.protectedFields=true;return null}
  return {type:'wordBookmark',attrs:{id:'native-'+id,name,side}}
}
export function bookmarkWriter(escape) {
  const ids=new Map(),sections=new Map(),names=new Set()
  function anchor(attrs) {
    const {id,name,side}=attrs
    if(!id || !validBookmark(name) || !['start','end'].includes(side)) throw Error('书签范围无效。请在书签窗口移除后重新添加。')
    if(!ids.has(id)) ids.set(id,ids.size+1)
    const flags=sections.get(id) || {}
    if(flags[side] || (flags.name && flags.name!==name) || (side==='start' && names.has(name.toLowerCase()))) throw Error('书签名称或位置重复。')
    sections.set(id,{...flags,name,[side]:true})
    if(side==='start')names.add(name.toLowerCase())
    return '<w:bookmark'+(side==='start'?'Start':'End')+' w:id="'+ids.get(id)+'"'+(side==='start'?' w:name="'+escape(name)+'"':'')+'/>'
  }
  function validate() {
    if([...sections.values()].some(v=>!v.start || !v.end)) throw Error('书签范围缺少起点或终点。请在书签窗口移除不完整的书签。')
  }
  return {anchor,validate}
}
export function referenceXml(attrs,escape) {
  if(!validBookmark(attrs.name))throw Error('交叉引用的书签名称无效。')
  const code=' REF '+attrs.name+(attrs.link===false?'':' \\h')+' '
  const runs=String(attrs.text || '').split('\n').map(line=>line.split('\t').map(s=>'<w:t xml:space="preserve">'+escape(s)+'</w:t>').join('<w:tab/>')).join('<w:br/>')
  return '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">'+escape(code)+'</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r>'+runs+'</w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'
}
function refNode(code,text) {
  const match=code.match(/^\s*REF\s+(?:"([^"]+)"|([^\s"]+))\s*(\\h)?\s*(?:\\\*\s+MERGEFORMAT\s*)?$/i)
  const name=match?.[1] || match?.[2]
  return validBookmark(name)?{type:'wordCrossRef',attrs:{name,text,link:!!match[3]}}:null
}
// A REF to a multi-paragraph bookmark expands to multiple cached paragraphs
// after Word updates it. Fold just that field back to its inline editor atom.
export function joinReferenceResults(container) {
  let guarded=false
  for(const paragraph of [...container.children]) {
    if(paragraph.parentElement!==container || paragraph.localName!=='p')continue
    const chars=elements(paragraph,'fldChar')
    if(!chars.length)continue
    let balance=0
    for(const ch of chars)balance+=({begin:1,end:-1}[attr(ch,'fldCharType')] || 0)
    if(balance!==1)continue
    const code=elements(paragraph,'instrText').map(el=>el.textContent).join('')
    if(!refNode(code,''))continue
    const tail=[]
    let next=paragraph.nextElementSibling
    for(;next && next.localName==='p' && balance>0;next=next.nextElementSibling){
      tail.push(next)
      for(const ch of elements(next,'fldChar'))balance+=({begin:1,end:-1}[attr(ch,'fldCharType')] || 0)
    }
    if(balance!==0 || !tail.length || tail.some(p=>elements(p,'sectPr').length)){guarded=true;continue}
    for(const line of tail) {
      const r=container.ownerDocument.createElementNS(W,'w:r')
      r.append(container.ownerDocument.createElementNS(W,'w:br'))
      paragraph.append(r)
      for(const child of [...line.children])if(child.localName!=='pPr')paragraph.append(child)
      line.remove()
    }
  }
  return guarded
}
export function paragraphFields(p) {
  const replacements=new Map(),skip=new Set(),stack=[]
  let guarded=false
  const simple=elements(p,'fldSimple')
  const complexContent=new Set(['bookmarkStart','bookmarkEnd','drawing','pict','object','footnoteReference','endnoteReference','hyperlink','ins','del','sdt','commentReference','sym','fldSimple'])
  const value=el=>el.localName==='t'?el.textContent:el.localName==='tab'?'\t':el.localName==='br'?'\n':''
  for(const el of simple) {
    const contents=elements(el,'*'),code=attr(el,'instr') || ''
    const node=refNode(code,contents.map(value).join('')) || storedTextField(code,contents,el)
    if(node) replacements.set(el,node)
    if(!node || contents.some(n=>n.localName==='fldChar' || complexContent.has(n.localName)))guarded=true
  }
  for(const leaf of elements(p,'*')) {
    const tag=leaf.localName
    if(stack.length && complexContent.has(tag))guarded=true
    if(leaf.children.length || !['fldChar','instrText','t','tab','br','cr','noBreakHyphen','softHyphen'].includes(tag)) continue
    if(tag==='fldChar' && attr(leaf,'fldCharType')==='begin') {
      if(stack.length)guarded=true
      stack.push({leaf,code:'',text:'',pieces:[],cache:[],result:false})
      continue
    }
    const field=stack.at(-1)
    if(!field) {
      if(tag==='fldChar' || tag==='instrText')guarded=true
      continue
    }
    field.pieces.push(leaf)
    if(tag==='fldChar') {
      const mode=attr(leaf,'fldCharType')
      if(mode==='separate')field.result=true
      if(mode==='end') {
        stack.pop()
        const node=refNode(field.code,field.text) || storedTextField(field.code,field.cache,field.leaf)
        if(!node){guarded=true;continue}
        replacements.set(field.leaf,node)
        for(const part of field.pieces)skip.add(part)
      }
    } else if(tag==='instrText' && !field.result)field.code+=leaf.textContent
    else if(field.result){field.text+=value(leaf);field.cache.push(leaf)}
    else guarded=true
  }
  return {replacements,skip,guarded:guarded || stack.length>0}
}

export function bookmarkRanges(doc) {
  const ranges=new Map(),references=[]
  doc.descendants((n,pos)=>{
    if(n.type.name==='wordCrossRef'){references.push({pos,node:n});return}
    if(n.type.name!=='wordBookmark')return
    const {id,name,side}=n.attrs
    const range=ranges.get(id) || {id,name}
    range[side]=pos;ranges.set(id,range)
  })
  return {ranges:[...ranges.values()],references}
}
export function bookmarkText(doc,range) {
  if(range.start==null || range.end==null || range.start>=range.end)return ''
  return doc.textBetween(range.start+1,range.end,'\n',node=>node.type.name==='wordCrossRef'?node.attrs.text:node.type.name==='hardBreak'?'\n':'')
}
