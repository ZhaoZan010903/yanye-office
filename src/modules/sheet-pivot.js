import { address, bounds, evaluator, inRect, LIMITS, location, newSheet, parseRange, rangeName } from './spreadsheet.js'

export const summaries = {sum:'求和', count:'计数', average:'平均值', min:'最小值', max:'最大值'}
const raw = value => typeof value==='number' ? String(value) : value ? "'"+value : ''

export function pivotHeaders(source, ref, display) {
  const box=parseRange(ref)
  if (!box || box.top===box.bottom) throw Error('源区域需要一行表头和至少一行数据。')
  if (box.bottom>=LIMITS.rows || box.right>=LIMITS.cols) throw Error('源区域超出当前工作表支持的行列数。')
  const headers=Array.from({length:box.right-box.left+1}, (_,n)=>String(display(source,address(box.top,box.left+n)) ?? '').trim())
  if (headers.some(h=>!h) || new Set(headers.map(h=>h.toLowerCase())).size!==headers.length) throw Error('源区域的每一列都需要唯一的非空表头。')
  if ((box.bottom-box.top)*headers.length>120000) throw Error('单个透视源最多支持 120,000 个数据单元格。')
  return headers
}
export function pivotData(book, pivot, display=evaluator(book)) {
  const source=book.sheets.find(s=>s.id===pivot.sourceId)
  if (!source) throw Error('找不到数据透视表的源工作表。')
  const headers=pivotHeaders(source,pivot.ref,display), box=parseRange(pivot.ref)
  if (!Object.hasOwn(summaries,pivot.summary) || headers[pivot.rowField]===undefined || headers[pivot.dataField]===undefined)
    throw Error('请选择有效的行字段、值字段和汇总方式。')
  const groups=new Map(), records=[], total={count:0, numeric:0, sum:0, min:Infinity, max:-Infinity}
  function accumulate(stat,v) {
    if (v!=='' && v!=null) stat.count++
    if (typeof v==='number' && Number.isFinite(v)) {
      stat.numeric++; stat.sum+=v; stat.min=Math.min(stat.min,v); stat.max=Math.max(stat.max,v)
    }
  }
  function result(stat) {
    if(pivot.summary==='count') return stat.count
    if(!stat.numeric) return pivot.summary==='sum'?0:''
    return {sum:stat.sum, average:stat.sum/stat.numeric, min:stat.min, max:stat.max}[pivot.summary]
  }
  for(let row=box.top+1;row<=box.bottom;row++) {
    const values=headers.map((_,offset)=>Object.hasOwn(source.cells,address(row,box.left+offset)) ? display(source,address(row,box.left+offset)) : '')
    const label=values[pivot.rowField], key=typeof label==='string'?label.toLowerCase():label
    if(!groups.has(key)) groups.set(key,{label, index:groups.size, count:0,numeric:0,sum:0,min:Infinity,max:-Infinity})
    const group=groups.get(key)
    accumulate(group,values[pivot.dataField]); accumulate(total,values[pivot.dataField])
    records.push({values,index:group.index})
  }
  const rows=[...groups.values()].map(group=>({label:group.label,value:result(group)}))
  const caption=pivot.caption || summaries[pivot.summary]+'：'+headers[pivot.dataField]
  return {source,headers,records,rows,total:result(total),caption}
}
export function refreshPivot(book, target) {
  const p=target.pivot, anchor=location(p.anchor), report=pivotData(book,p)
  const area=bounds(anchor,{row:anchor.row+report.rows.length+1,col:anchor.col+1})
  if(area.bottom>=LIMITS.rows || area.right>=LIMITS.cols) throw Error('透视结果超出工作表边界。')
  const old=p.reportRange && parseRange(p.reportRange)
  const cells={...target.cells}
  for(const ref of Object.keys(cells)) {
    const {row,col}=location(ref)
    if(old && inRect(old,row,col)) delete cells[ref]
    else if(inRect(area,row,col)) throw Error('透视表展开后会覆盖已有单元格。请先腾出空间。')
  }
  const matrix=[[report.headers[p.rowField],report.caption],...report.rows.map(g=>[g.label===''?'(空白)':g.label,g.value]),['总计',report.total]]
  matrix.forEach((line,r)=>line.forEach((v,c)=>{ if(v!=='') cells[address(anchor.row+r,anchor.col+c)]=raw(v) }))
  return {...target,rows:Math.max(target.rows,area.bottom+1),cols:Math.max(target.cols,area.right+1),cells,pivot:{...p,reportRange:rangeName(area)}}
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
