import {parseDelimited} from './spreadsheet.js'

export function mergeName(code) {
  const match=/^\s*MERGEFIELD\s+(?:"([^"]+)"|([^\s\\]+))/i.exec(code || '')
  return match?.[1] || match?.[2] || ''
}
export function recipientTable(source,separator=',') {
  const [head=[],...rows]=parseDelimited(source,separator)
  const columns=head.map(s=>s.trim())
  if(!columns.length || columns.some(s=>!s || /["\\\r\n]/.test(s)) || new Set(columns).size!==columns.length)throw Error('首行需要唯一、非空的字段名，名称中不能有引号、换行或反斜线。')
  const data=rows.filter(row=>row.some(v=>v!==''))
  if(!data.length)throw Error('数据源至少需要一条收件人记录。')
  if(data.some(row=>row.length!==columns.length))throw Error('收件人记录的列数与首行不同。')
  return {columns,rows:data}
}
export function mergeField(name) {
  const text='«'+name+'»'
  return {type:'wordTextField',attrs:{code:' MERGEFIELD "'+name+'" ',text,runs:[{kind:'t',text}],dirty:null,lock:null}}
}
function bookmarkCopies(content){
  const names=new Set()
  function scan(n){
    if(n.type==='wordBookmark')names.add(n.attrs.name)
    if(n.type==='wordToc')for(const a of [...n.attrs.before||[],...n.attrs.after||[]])names.add(a.name)
    n.content?.forEach(scan)
  }
  content.forEach(scan)
  const used=new Set([...names].map(n=>n.toLowerCase()))
  let sequence=0
  return index=>{
    if(!index)return node=>node
    const copies=new Map()
    for(const name of names){
      let next
      do{next='Merge_'+(++sequence)}while(used.has(next.toLowerCase()))
      used.add(next.toLowerCase())
      copies.set(name.toLowerCase(),next)
    }
    const name=n=>copies.get(n.toLowerCase())||n
    const anchor=a=>({...a,id:index+'-'+a.id,name:name(a.name)})
    return node=>{
      let attrs=node.attrs,marks=node.marks
      if(node.type==='wordBookmark')attrs=anchor(attrs)
      if(node.type==='wordCrossRef')attrs={...attrs,name:name(attrs.name)}
      if(node.type==='wordToc')attrs={...attrs,before:(attrs.before||[]).map(anchor),after:(attrs.after||[]).map(anchor)}
      if(marks?.some(m=>m.type==='link' && m.attrs.href?.startsWith('#')))marks=marks.map(m=>{
        if(m.type!=='link' || !m.attrs.href?.startsWith('#'))return m
        return {...m,attrs:{...m.attrs,href:'#'+name(m.attrs.href.slice(1))}}
      })
      return {...node,...(attrs?{attrs}:{}),...(marks?{marks}:{})}
    }
  }
}
export function mergeDocuments(template,table,indices) {
  if(!indices.length)throw Error('没有选择记录。')
  const base=template.doc?.content || [],content=[]
  if(JSON.stringify(base).length*indices.length>32*1024*1024)throw Error('合并结果过大，请分批导出。')
  let count=0
  const indexOf=new Map(table.columns.map((name,i)=>[name,i]))
  const bookmarks=bookmarkCopies(base)
  for(const [i,index] of indices.entries()){
    const record=table.rows[index]
    const rename=bookmarks(i)
    if(!record)throw Error('所选记录无效。')
    function replace(node) {
      const field=node.type==='wordTextField' && mergeName(node.attrs.code)
      if(field){
        if(!indexOf.has(field))throw Error('数据源缺少字段「'+field+'」。')
        count++
        const value=record[indexOf.get(field)]
        const properties=node.attrs.runs?.find(run=>run.properties)?.properties
        return value?[{type:'wordMergedText',attrs:{text:value,properties},...(node.marks?{marks:node.marks}:{})}]:[]
      }
      const next=rename(node)
      if(!next.content)return [next]
      return [{...next,content:next.content.flatMap(replace)}]
    }
    content.push(...base.flatMap(replace))
    if(i<indices.length-1)content.push({type:'sectionBreak',attrs:{layout:{...template.layout,start:'nextPage'}}})
  }
  if(!count)throw Error('请先在正文或表格中插入合并域。')
  return {...template,doc:{type:'doc',content}}
}
