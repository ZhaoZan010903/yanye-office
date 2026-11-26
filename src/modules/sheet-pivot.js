import { address, bounds, evaluator, inRect, LIMITS, location, newSheet, parseRange, rangeName } from './spreadsheet.js'

export const summaries = {sum:'求和', count:'计数', average:'平均值', min:'最小值', max:'最大值'}
const raw = value => typeof value==='number' ? String(value) : value ? "'"+value : ''
export const pivotKey = value => typeof value==='string' ? value.toLowerCase() : value
export const rowAxis = pivot => pivot.rowFields || [pivot.rowField]

export function pivotHeaders(source, ref, display) {
  const box=parseRange(ref)
  if (!source || !box || box.top===box.bottom) throw Error('源区域需要一行表头和至少一行数据。')
  if (box.bottom>=LIMITS.rows || box.right>=LIMITS.cols) throw Error('源区域超出当前工作表支持的行列数。')
  const headers=Array.from({length:box.right-box.left+1}, (_,n)=>String(display(source,address(box.top,box.left+n)) ?? '').trim())
  if (headers.some(h=>!h) || new Set(headers.map(h=>h.toLowerCase())).size!==headers.length) throw Error('源区域的每一列都需要唯一的非空表头。')
  if ((box.bottom-box.top)*headers.length>120000) throw Error('单个透视源最多支持 120,000 个数据单元格。')
  return headers
}

function accumulate(bucket,column,v) {
  let stat=bucket.get(column)
  if (!stat) {stat={count:0,numeric:0,sum:0,min:Infinity,max:-Infinity};bucket.set(column,stat)}
  if (v!=='' && v!=null) stat.count++
  if (typeof v==='number' && Number.isFinite(v)) {
    stat.numeric++; stat.sum+=v; stat.min=Math.min(stat.min,v); stat.max=Math.max(stat.max,v)
  }
}
function valueOf(stat,summary) {
  if (!stat) return ''
  if (summary==='count') return stat.count
  if (!stat.numeric) return summary==='sum'?0:''
  return summary==='average' ? stat.sum/stat.numeric : stat[summary]
}
function branch() { return {children:new Map(),stats:new Map()} }

export function pivotData(book,pivot,display=evaluator(book)) {
  const source=book.sheets.find(s=>s.id===pivot.sourceId)
  if (!source) throw Error('找不到数据透视表的源工作表。')
  const headers=pivotHeaders(source,pivot.ref,display), box=parseRange(pivot.ref)
  const rows=rowAxis(pivot), col=pivot.columnField??null, slicers=pivot.slicers||[]
  const axes=col==null ? rows : [...rows,col]
  const valid=i=>Number.isInteger(i) && i>=0 && i<headers.length
  if (!rows.length || new Set(axes).size!==axes.length || !axes.every(valid) || !valid(pivot.dataField) || !Object.hasOwn(summaries,pivot.summary))
    throw Error('请选择有效且不重复的行列字段并设置汇总方式。')
  if (new Set(slicers.map(s=>s.field)).size!==slicers.length || !slicers.every(s=>valid(s.field))) throw Error('切片器字段无效或重复。')
  const indexed=new Set([...axes,...slicers.map(s=>s.field)])
  const keys=headers.map(()=>new Map()), members=headers.map(()=>[]), records=[]
  const root=branch(), columns=new Set()
  for (let row=box.top+1;row<=box.bottom;row++) {
    const values=headers.map((_,i)=>Object.hasOwn(source.cells,address(row,box.left+i))?display(source,address(row,box.left+i)):'')
    const indices=values.map((v,i)=>{
      if (!indexed.has(i)) return null
      const k=pivotKey(v)
      if (!keys[i].has(k)) {keys[i].set(k,members[i].length);members[i].push(v)}
      return keys[i].get(k)
    })
    records.push({values,indices})
  }
  // Native pivot fields can have a manual member order independent of source rows.
  // Use that order for the cache, report and indices in the native axis items.
  for(const field of axes) {
    const prior=pivot.order?.[field]
    if(!prior) continue
    const rank=new Map(prior.map((v,i)=>[pivotKey(v),i]))
    const order=members[field].map((v,i)=>({v,i,rank:rank.get(pivotKey(v))??Infinity})).sort((a,b)=>a.rank-b.rank)
    members[field]=order.map(o=>o.v)
    const remap=new Map(order.map((o,i)=>[o.i,i]))
    for(const record of records) record.indices[field]=remap.get(record.indices[field])
  }
  const normalizedSlicers=slicers.map(s=>{
    if(!s.selected) return s
    const wanted=new Set(s.selected.map(pivotKey))
    const live=members[s.field].filter(v=>wanted.has(pivotKey(v)))
    return {...s,selected:live.length && live.length<members[s.field].length?live:null}
  })
  const filters=normalizedSlicers.filter(s=>s.selected).map(s=>({field:s.field,values:new Set(s.selected.map(pivotKey))}))
  for (const {values,indices} of records) {
    if (filters.some(f=>!f.values.has(pivotKey(values[f.field])))) continue
    const column=col==null?null:indices[col], amount=values[pivot.dataField]
    if (col!=null) columns.add(column)
    let level=root
    for (const field of [...rows,null]) {
      accumulate(level.stats,null,amount)
      if(col!=null) accumulate(level.stats,column,amount)
      if(field==null) break
      const i=indices[field]
      if(!level.children.has(i)) level.children.set(i,branch())
      level=level.children.get(i)
    }
  }
  const compact=pivot.layout==='compact', rowWidth=compact?1:rows.length
  const sorted=(list,field)=>pivot.order?.[field]?list.sort((a,b)=>a-b):list
  const rowItems=[], colItems=sorted([...columns],col), subtotalFields=pivot.subtotalFields??rows.slice(0,-1)
  function visit(node,path) {
    for (const index of sorted([...node.children.keys()],rows[path.length])) {
      const next=node.children.get(index)
      const coords=[...path,index]
      if(coords.length===rows.length) rowItems.push({path:coords,stats:next.stats})
      else {
        if(compact) rowItems.push({path:coords,stats:subtotalFields.includes(rows[coords.length-1])?next.stats:new Map()})
        visit(next,coords)
        if (!compact && subtotalFields.includes(rows[coords.length-1])) rowItems.push({path:coords,stats:next.stats,kind:'default'})
      }
    }
  }
  visit(root,[])
  rowItems.push({path:[],stats:root.stats,kind:'grand'})
  const caption=pivot.caption || summaries[pivot.summary]+'：'+headers[pivot.dataField]
  return {source,headers,records,members,rows,col,colItems,rowItems,caption,subtotalFields,summary:pivot.summary,compact,rowWidth,
    rowCaption:pivot.rowCaption||'行标签',colCaption:pivot.colCaption||'列标签',slicers:normalizedSlicers}
}

function resultMatrix(data) {
  const {headers,rows,col,colItems,rowItems,members,caption,summary}=data
  const label=(field,index)=>members[field][index]===''?'(空白)':members[field][index]
  const fields=data.compact?[data.rowCaption]:rows.map(f=>headers[f]), extra=Array(data.rowWidth-1).fill('')
  const matrix=col==null ? [[...fields,caption]] : [
    [caption,...extra,data.compact?data.colCaption:headers[col]],
    [...fields,...colItems.map(i=>label(col,i)),'总计'],
  ]
  let last=[]
  for (const item of rowItems) {
    let repeat=true
    const depth=item.path.length-1
    const labels=data.compact ? [item.kind==='grand'?'总计':label(rows[depth],item.path[depth])] : rows.map((field,depth)=>{
      if(item.kind==='grand') return depth===0?'总计':''
      if(depth>=item.path.length) return ''
      const index=item.path[depth], text=label(field,index)
      repeat=repeat && last[depth]===index
      if(item.kind==='default' && depth===item.path.length-1) return text+' 汇总'
      return repeat?'':text
    })
    last=item.path
    matrix.push([...labels,...colItems.map(i=>valueOf(item.stats.get(i),summary)),valueOf(item.stats.get(null),summary)])
  }
  return matrix
}

export function refreshPivot(book,target) {
  const p=target.pivot, anchor=location(p.anchor), report=pivotData(book,p)
  const headerRows=report.col==null?1:2
  const area=bounds(anchor,{row:anchor.row+report.rowItems.length+headerRows-1,col:anchor.col+report.rowWidth+report.colItems.length})
  if(area.bottom>=LIMITS.rows || area.right>=LIMITS.cols) throw Error('透视结果超出工作表边界。')
  const old=p.reportRange && parseRange(p.reportRange), cells={...target.cells}
  for(const ref of Object.keys(cells)) {
    const {row,col}=location(ref)
    if(old && inRect(old,row,col)) delete cells[ref]
    else if(inRect(area,row,col)) throw Error('透视表展开后会覆盖已有单元格。请先腾出空间。')
  }
  resultMatrix(report).forEach((line,r)=>line.forEach((v,c)=>{ if(v!=='') cells[address(anchor.row+r,anchor.col+c)]=raw(v) }))
  const styles={...target.styles}
  if(old) for(const [ref,style] of Object.entries(styles)) {
    const at=location(ref)
    if(style.indent && inRect(old,at.row,at.col)) {const {indent,...rest}=style;styles[ref]=rest}
  }
  if(report.compact) report.rowItems.forEach((item,r)=>{
    const ref=address(anchor.row+headerRows+r,anchor.col)
    if(item.path.length>1) styles[ref]={...styles[ref],indent:item.path.length-1}
  })
  return {...target,rows:Math.max(target.rows,area.bottom+1),cols:Math.max(target.cols,area.right+1),cells,styles,pivot:{...p,slicers:report.slicers,reportRange:rangeName(area)}}
}

export function editsPivotResults(original,next) {
  if(!original.pivot || original.cells===next.cells) return false
  const box=parseRange(original.pivot.reportRange)
  if(!box) return false
  for(let r=box.top;r<=box.bottom;r++) for(let c=box.left;c<=box.right;c++) {
    const key=address(r,c)
    if(original.cells[key]!==next.cells[key]) return true
  }
  return false
}
export function createPivot(book, source, config) {
  if(book.sheets.length>=LIMITS.sheets) throw Error('工作簿最多支持 32 张工作表。')
  let n=1
  while(book.sheets.some(s=>s.name==='透视表'+n || s.pivot?.name.toLowerCase()==='pivottable'+n)) n++
  const target=refreshPivot(book,{...newSheet('透视表'+n),pivot:{
    name:'PivotTable'+n,sourceId:source.id,anchor:'A1',...config,
  }})
  return {...book,sheets:[...book.sheets,target],active:target.id}
}
