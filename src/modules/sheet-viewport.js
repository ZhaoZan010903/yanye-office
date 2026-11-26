import {address,filterRow,formatted,location,findMerge} from './spreadsheet.js'

export const rowHeight=30
const collator=new Intl.Collator('zh-CN',{numeric:true})

export function rowOrder(sheet,display) {
  const query=sheet.query?.trim().toLocaleLowerCase()
  const filtered=Object.keys(sheet.autoFilter?.columns || {}).length>0
  let order,positions
  if (query || filtered || sheet.sort || sheet.hiddenRows?.length) {
    const hidden=new Set(sheet.hiddenRows || [])
    if (query) {
      const matches=new Set()
      for (const key of Object.keys(sheet.cells)) {
        const point=location(key)
        if (point.row>0 && !hidden.has(point.row) && String(display(sheet,key)).toLocaleLowerCase().includes(query)) matches.add(point.row)
      }
      order=[...matches].sort((a,b)=>a-b)
    } else {
      order=Array.from({length:sheet.rows-1},(_,i)=>i+1).filter(r=>!hidden.has(r))
    }
    if (filtered) order=order.filter(r=>filterRow(sheet,r,display))
    if (sheet.sort) {
      const sort=sheet.sort, values=new Map()
      function value(r) {
        if (!values.has(r)) values.set(r,display(sheet,address(r,sort.col)))
        return values.get(r)
      }
      order.sort((a,b)=>{
        const left=value(a),right=value(b)
        if (left==='' || right==='') return Number(left==='')-Number(right==='')
        const cmp=typeof left==='number' && typeof right==='number' ? left-right : collator.compare(String(left),String(right))
        return sort.desc ? -cmp : cmp
      })
    }
    if (!hidden.has(0)) order.unshift(0)
    positions=new Map(order.map((r,i)=>[r,i]))
  }
  return {length:order?.length ?? sheet.rows,
    at:i=>order ? order[i] : i,
    index:r=>positions ? (positions.get(r) ?? -1) : r,
    slice:(lo,hi)=>order ? order.slice(lo,hi) : Array.from({length:Math.max(0,hi-lo)},(_,i)=>lo+i)}
}

// A tall sheet with no custom heights needs only its row count. Lookups touch
// the size exceptions and never allocate an array of every row in the sheet.
export function sizedAxis(count,standard,overrides={}) {
  const changes=Object.keys(overrides).map(Number).filter(i=>i>=0 && i<count).sort((a,b)=>a-b)
  const extra=[0]
  for (const i of changes) extra.push(extra.at(-1)+overrides[i]-standard)
  const offset=index=>{
    let lo=0,hi=changes.length
    while(lo<hi) {const mid=(lo+hi)>>>1;if(changes[mid]<index)lo=mid+1;else hi=mid}
    return index*standard+extra[lo]
  }
  return {count,total:offset(count),size:i=>overrides[i] ?? standard,offset,
    index(pixel){
      let lo=0,hi=count-1
      while(lo<hi) {const mid=Math.ceil((lo+hi)/2);if(offset(mid)<=pixel)lo=mid;else hi=mid-1}
      return lo
    }}
}

export function columnAxis(sheet) {
  const sizes={}
  for(const [c,width] of Object.entries(sheet.widths || {})) sizes[c]=Math.max(15,Math.round(width*7+5))
  return sizedAxis(sheet.cols,104,sizes)
}

export function rowSizes(sheet,display,columns) {
  const sizes={}
  const candidates=Object.entries(sheet.styles || {})
  let measure
  for(const [ref,style] of candidates) {
    if (!style.wrap && !(style.size>15)) continue
    const {row,col}=location(ref)
    let height=Math.max(rowHeight,Math.ceil((style.size || 10)*1.7)+4)
    if (style.wrap && sheet.cells[ref] && !sheet.heights?.[row]) {
      measure ??=document.createElement('canvas').getContext('2d')
      const size=style.size || 10
      const merged=findMerge(sheet,row,col)
      const width=columns.offset((merged?.right ?? col)+1)-columns.offset(col)
      if(measure) {
        measure.font=(style.bold?'bold ':'')+size+'pt '+(style.font || '"Segoe UI",sans-serif')
        const lines=String(formatted(display(sheet,ref),sheet.formats?.[ref])).split(/\r?\n/).reduce((n,s)=>
          n+Math.max(1,Math.ceil(measure.measureText(s).width/Math.max(1,width-15-(style.indent || 0)*12))),0)
        height=Math.max(height,Math.min(545,Math.ceil(lines*size*1.85)+5))
      }
    }
    if(height>rowHeight) sizes[row]=Math.max(sizes[row] || rowHeight,height)
  }
  for(const [r,pt] of Object.entries(sheet.heights || {})) sizes[r]=Math.max(12,Math.round(pt*4/3))
  return sizes
}

export function visibleColumns(axis,left,width,frozen) {
  const first=Math.max(0,axis.index(left)-2)
  const end=Math.min(axis.count,axis.index(left+width)+3)
  const result=[]
  if(frozen && first) result.push({col:0,width:axis.size(0)})
  const start=frozen && first ? 1 : 0
  if(first>start) result.push({spacer:'left',width:axis.offset(first)-axis.offset(start)})
  for(let c=first;c<end;c++)result.push({col:c,width:axis.size(c)})
  if(end<axis.count)result.push({spacer:'right',width:axis.total-axis.offset(end)})
  return result
}
