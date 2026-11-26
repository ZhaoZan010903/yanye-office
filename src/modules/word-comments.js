const word='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const elements=(node,tag)=>[...(node?.getElementsByTagNameNS(word,tag)??[])]
const attribute=(node,name)=>node.getAttributeNS(word,name)??''

export function readComments(root,warn) {
  const result=new Map()
  for(const comment of elements(root,'comment')) {
    const id=attribute(comment,'id')
    const text=elements(comment,'p').map(p=>{
      let line=''
      for(const el of p.getElementsByTagNameNS(word,'*')) {
        if(el.localName==='t') line+=el.textContent
        else if(el.localName==='br') line+='\n'
        else if(el.localName==='tab') line+='\t'
      }
      return line
    }).join('\n')
    if(elements(comment,'drawing').length || elements(comment,'tbl').length || elements(comment,'hyperlink').length) warn('含图形、表格或链接的批注简化为文字，请保留原版式文件')
    if(id && text) result.set(id,{id:'native-'+id,text,author:attribute(comment,'author'),date:attribute(comment,'date')})
  }
  return result
}

// Emit a separate native range for each contiguous group of marked text.
// Copying a range or splitting the paragraph must never annotate intervening text.
export function commentWriter(escape) {
  const notes=[]
  function paragraph(nodes,inline,revisionStart,linkStart) {
    const spans=new Map()
    let xml='', revision=null, href=null
    function close(id) {
      const index=spans.get(id)
      spans.delete(id)
      return '<w:commentRangeEnd w:id="'+index+'"/><w:r><w:commentReference w:id="'+index+'"/></w:r>'
    }
    for(const node of nodes) {
      const mark=node.marks?.find(m=>m.type==='wordRevision')?.attrs
      const next=mark && ['ins','del'].includes(mark.kind)?mark:null
      const link=node.marks?.find(m=>m.type==='link')?.attrs?.href
      const nextHref=/^(?:https?:\/\/|mailto:)/i.test(link)?link:null
      // OOXML permits a revision inside a hyperlink, in this order only.
      if (nextHref!==href || revision?.id!==next?.id || revision?.kind!==next?.kind) {
        if (revision) xml+='</w:'+revision.kind+'>'
        if (nextHref!==href) {
          if (href) xml+='</w:hyperlink>'
          href=nextHref
          if (href) xml+=linkStart(href)
        }
        revision=next
        if (revision) xml+=revisionStart(revision)
      }
      const comments=(node.marks??[]).filter(m=>m.type==='wordComment' && m.attrs?.id && m.attrs?.text).map(m=>m.attrs)
      for(const id of spans.keys()) if(!comments.some(c=>c.id===id)) xml+=close(id)
      for(const c of comments) if(!spans.has(c.id)) {
        const index=notes.length
        spans.set(c.id,index);notes.push(c)
        xml+='<w:commentRangeStart w:id="'+index+'"/>'
      }
      xml+=inline(node)
    }
    if(revision) xml+='</w:'+revision.kind+'>'
    if(href) xml+='</w:hyperlink>'
    for(const id of spans.keys()) xml+=close(id)
    return xml
  }
  function body() {
    return '<w:comments xmlns:w="'+word+'">'+notes.map((c,i)=>{
      const date=c.date && Number.isFinite(Date.parse(c.date))?' w:date="'+escape(c.date)+'"':''
      const lines=c.text.split('\n').map(line=>'<w:p><w:r><w:t xml:space="preserve">'+escape(line)+'</w:t></w:r></w:p>').join('')
      return '<w:comment w:id="'+i+'" w:author="'+escape(c.author??'')+'"'+date+'>'+lines+'</w:comment>'
    }).join('')+'</w:comments>'
  }
  return {notes,paragraph,body}
}
