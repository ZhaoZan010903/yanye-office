const labels={heading:'标题',paragraph:'段落',table:'表格',sectionBreak:'分节',pageBreak:'分页',wordToc:'目录'}
const ignore=new Set(['id','native','date','compatibility'])
const collection=['paragraph','heading']
function stable(value){
  if(Array.isArray(value))return value.map(stable)
  if(!value || typeof value!=='object')return value
  return Object.fromEntries(Object.entries(value).filter(([k,v])=>!ignore.has(k) && v!=null && (typeof v!=='object' || Object.keys(v).length)).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]))
}
export function plain(node){
  if(node.type==='text')return node.text
  if(node.type==='hardBreak')return '\n'
  if(node.type==='wordEquation')return node.attrs.source || node.attrs.label || '公式'
  if(node.type==='wordTextBox')return '〔文本框〕'+node.attrs.text
  if(node.type==='image')return '〔图片〕'+(node.attrs.alt||'')
  if(node.type==='wordBookmark')return ''
  if(node.attrs?.text)return node.attrs.text
  return (node.content||[]).map(plain).join(node.type==='tableRow'?'\t':['table','doc'].includes(node.type)?'\n':'')
}
function signature(node){return JSON.stringify(stable(node))}
const propertyLabels={type:'类型',level:'标题级别',align:'对齐',font:'中文字体',latinFont:'西文字体',size:'字号',color:'颜色',x:'水平偏移',y:'垂直偏移',width:'宽度',height:'高度',fill:'填充色',line:'边框色',lineSpacing:'行距',spaceBefore:'段前间距',spaceAfter:'段后间距',leftIndent:'左缩进',bold:'粗体',italic:'斜体',underline:'下划线',strike:'删除线'}
function formatDetails(original,revised){
  const before=[],after=[]
  const display=v=>v==null?'默认':String(propertyLabels[v]||v).slice(0,80)
  function visit(a,b,path){
    if(before.length>=12 || a===b)return
    if((a!=null && typeof a==='object') || (b!=null && typeof b==='object')){
      for(const key of new Set([...Object.keys(a||{}),...Object.keys(b||{})]))visit(a?.[key],b?.[key],[...path,key])
      return
    }
    const key=path.at(-1)
    const label=propertyLabels[key] || key
    before.push(label+' '+display(a));after.push(label+' '+display(b))
  }
  visit(stable(original),stable(revised),[])
  return {before,after}
}
function differences(a,b){
  const left=a.map(signature),right=b.map(signature)
  let start=0,endA=a.length,endB=b.length
  while(start<endA && start<endB && left[start]===right[start])start++
  while(endA>start && endB>start && left[endA-1]===right[endB-1]){endA--;endB--}
  const anchors=[]
  const n=endA-start,m=endB-start
  if(n*m<=1000000 && n && m){
    const lens=new Uint32Array((n+1)*(m+1)),stride=m+1
    for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)lens[i*stride+j]=left[start+i]===right[start+j]?1+lens[(i+1)*stride+j+1]:Math.max(lens[(i+1)*stride+j],lens[i*stride+j+1])
    let i=0,j=0
    while(i<n && j<m){
      if(left[start+i]===right[start+j]){anchors.push([start+i,start+j]);i++;j++}
      else if(lens[(i+1)*stride+j]>=lens[i*stride+j+1])i++
      else j++
    }
  }else{
    const positions=new Map()
    for(let j=start;j<endB;j++)positions.set(right[j],positions.has(right[j])?-1:j)
    let previous=start-1
    for(let i=start;i<endA;i++){const j=positions.get(left[i]);if(j>previous){anchors.push([i,j]);previous=j}}
  }
  const result=[]
  let i=start,j=start
  for(const [p,q] of [...anchors,[endA,endB]]){
    while(i<p || j<q){
      const original=i<p?a[i++]:null,revised=j<q?b[j++]:null
      result.push({original,revised,position:original?i:j,kind:!original?'新增':!revised?'删除':plain(original)===plain(revised)?'格式或对象属性':'修改'})
    }
    i=p+1;j=q+1
  }
  return result
}
export function compareWord(a,b){
  const changes=differences(a.doc?.content||[],b.doc?.content||[])
  for(const change of changes)if(change.kind==='格式或对象属性')Object.assign(change,formatDetails(change.original,change.revised))
  if(signature({...a.layout,textDefaults:a.textDefaults,pageColor:a.pageColor})!==signature({...b.layout,textDefaults:b.textDefaults,pageColor:b.pageColor})){
    changes.push({kind:'页面或默认格式',position:null,original:{type:'paragraph',content:[{type:'text',text:describeLayout(a)}]},revised:{type:'paragraph',content:[{type:'text',text:describeLayout(b)}]}})
  }
  return changes
}
function describeLayout(doc){
  const l=doc.layout||{},font=doc.textDefaults||{}
  return [l.paper,l.landscape?'横向':'纵向',[l.top,l.right,l.bottom,l.left].map(v=>Number(v??0).toFixed(1)).join('/')+' mm',font.font,font.size?font.size+' pt':'',doc.pageColor].filter(Boolean).join(' · ')
}
export function comparisonText(node,details=[]){
  if(!node)return '—'
  return [plain(node) || ('〔'+(labels[node.type]||node.type)+'〕'),...details].join('\n')
}
export function comparisonReport(changes){
  const p=text=>({type:'paragraph',content:[{type:'text',text}]})
  const rows=[['变更','原文','修订稿'],...changes.map(c=>[c.kind+(c.position?' · '+c.position:''),comparisonText(c.original,c.before),comparisonText(c.revised,c.after)])]
  return {doc:{type:'doc',content:[{type:'heading',attrs:{level:1},content:[{type:'text',text:'文档比较结果'}]},
    {type:'table',content:rows.map((row,i)=>({type:'tableRow',content:row.map(v=>({type:i?'tableCell':'tableHeader',content:v.split('\n').map(line=>line?p(line):{type:'paragraph'})}))}))}]}}
}

// A review copy keeps Word's native runs, so accepting/rejecting the text edits
// can recover either version. Structural comparisons are available as a report.
export function reviewCopy(original,revised) {
  const a=original.doc.content,b=revised.doc.content
  if(a.length!==b.length)return null
  const content=[], metadata={author:'文档比较',date:new Date().toISOString()}
  for(let i=0;i<a.length;i++){
    if(signature(a[i])===signature(b[i])){content.push(b[i]);continue}
    if(!collection.includes(a[i].type) || a[i].type!==b[i].type || signature(a[i].attrs)!==signature(b[i].attrs))return null
    if(![...(a[i].content||[]),...(b[i].content||[])].every(n=>n.type==='text' && !n.marks?.some(m=>m.type==='wordRevision')))return null
    const expand=n=>(n.content||[]).flatMap(run=>{const key=JSON.stringify(run.marks||[]);return Array.from(run.text,s=>({s,key,marks:run.marks}))})
    const left=expand(a[i]),right=expand(b[i]),same=(l,r)=>l.s===r.s && l.key===r.key
    let prefix=0,suffix=0
    while(prefix<left.length && prefix<right.length && same(left[prefix],right[prefix]))prefix++
    while(suffix<left.length-prefix && suffix<right.length-prefix && same(left[left.length-1-suffix],right[right.length-1-suffix]))suffix++
    const runs=[]
    const append=(tokens,kind)=>{
      const revision=kind?{type:'wordRevision',attrs:{...metadata,kind,id:crypto.randomUUID()}}:null
      let last=null,key=null
      for(const token of tokens){
        if(!last || key!==token.key){
          const marks=revision?[...(token.marks||[]),revision]:token.marks
          last={type:'text',text:'',...(marks?.length?{marks}:{})};runs.push(last);key=token.key
        }
        last.text+=token.s
      }
    }
    append(left.slice(0,prefix))
    append(left.slice(prefix,left.length-suffix),'del');append(right.slice(prefix,right.length-suffix),'ins')
    if(suffix)append(right.slice(-suffix))
    content.push({...b[i],content:runs})
  }
  return {...revised,doc:{type:'doc',content}}
}
