import {location,LIMITS} from './spreadsheet.js'
import {sizedAxis} from './sheet-viewport.js'
import {marginPresets} from './sheet-page.js'

const sizes={1:[215.9,279.4],5:[215.9,355.6],8:[297,420],9:[210,297],11:[148,210]}
const px=96/25.4

function extent(sheet) {
  let top=Infinity,left=Infinity,bottom=0,right=0
  function include(row,col) {
    top=Math.min(top,row); left=Math.min(left,col); bottom=Math.max(bottom,row); right=Math.max(right,col)
  }
  for(const cells of [sheet.cells,sheet.styles,sheet.formats]) {
    for(const ref of Object.keys(cells || {})) {
      const p=location(ref)
      if(p)include(p.row,p.col)
    }
  }
  for(const m of sheet.merges || []) {include(m.top,m.left);include(m.bottom,m.right)}
  return Number.isFinite(top) ? {top,left,bottom,right} : {top:0,left:0,bottom:0,right:0}
}

function titles(ref,isRow) {
  const names=String(ref || '').replaceAll('$','').split(':')
  const index=v=>isRow ? Number(v)-1 : location(v+'1')?.col
  const start=index(names[0]),end=index(names[1] || names[0])
  return Number.isInteger(start) && Number.isInteger(end) && start>=0 && end>=start ? [start,end] : null
}

function bands(axis,first,last,available,title) {
  const result=[]
  for(let start=first;start<=last;) {
    // Excel repeats earlier title rows/columns; keep titles already in the body only once.
    const repeated=title && start>title[0] ? [title[0],Math.min(title[1],start-1)] : null
    const size=repeated ? axis.offset(repeated[1]+1)-axis.offset(repeated[0]) : 0
    if(size>=available)throw Error('重复标题已占满纸面，请减少标题范围或调整缩放。')
    const boundary=axis.offset(start)+available-size+.001
    const end=boundary>=axis.offset(last+1) ? last : Math.max(start,axis.index(boundary)-1)
    result.push({start,end,repeated})
    start=end+1
  }
  return result
}

function indices(band) {
  const seq=(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i)
  return [...(band.repeated ? seq(...band.repeated) : []),...seq(band.start,band.end)]
}

export function printLayout(sheet) {
  const setup=sheet.pageSetup || {}, margins={...marginPresets.常规,...setup.margins}
  let [widthMm,heightMm]=sizes[setup.paperSize] || sizes[9]
  if(setup.orientation==='landscape') [widthMm,heightMm]=[heightMm,widthMm]
  const availableW=widthMm*px-96*(margins.left+margins.right),availableH=heightMm*px-96*(margins.top+margins.bottom)
  if(availableW<10 || availableH<10)throw Error('页边距已超过纸张可用空间。')
  const rw={},cw={}
  for(const [i,v] of Object.entries(sheet.heights || {})) rw[i]=Math.max(1,v*4/3)
  for(const [i,v] of Object.entries(sheet.widths || {})) cw[i]=Math.max(1,Math.floor(v*7+5))
  const rows=sizedAxis(LIMITS.rows,Math.max(1,(sheet.defaultRowHeight || 15)*4/3),rw)
  const cols=sizedAxis(LIMITS.cols,Math.floor((sheet.defaultColWidth || 8.43)*7+5),cw)
  const titleRows=titles(setup.printTitlesRow,true), titleCols=titles(setup.printTitlesColumn,false)
  const boxes=setup.areas?.length ? setup.areas : [extent(sheet)]
  const groups=[]
  let count=0
  for(const box of boxes) {
    const headW=setup.showRowColHeaders ? 40 : 0,headH=setup.showRowColHeaders ? 20 : 0
    const dimensions=(axis,start,end)=>axis.offset(end+1)-axis.offset(start)
    let scale=Math.max(.1,Math.min(4,(setup.scale || 100)/100))
    if(setup.fitToPage) {
      const fit=(axis,start,end,limit,available,head,title)=>{
        if(!limit)return Infinity
        const repeated=title ? dimensions(axis,title[0],title[1]) : 0
        const firstTitles=title && start>title[1] ? repeated : 0
        return available*limit/(head*limit+dimensions(axis,start,end)+repeated*(limit-1)+firstTitles)
      }
      scale=Math.max(.1,Math.min(1,fit(cols,box.left,box.right,setup.fitToWidth,availableW,headW,titleCols),
        fit(rows,box.top,box.bottom,setup.fitToHeight,availableH,headH,titleRows)))
    }
    const xs=bands(cols,box.left,box.right,availableW/scale-headW,titleCols)
    const ys=bands(rows,box.top,box.bottom,availableH/scale-headH,titleRows)
    groups.push({xs,ys,scale,start:count})
    count+=xs.length*ys.length
  }
  return {count,widthMm,heightMm,margins,rows,cols,pageAt(index){
    const group=groups.findLast(group=>group.start<=index)
    const {xs,ys,scale,start}=group,n=index-start,across=setup.pageOrder==='overThenDown'
    return {cols:indices(xs[across ? n%xs.length : Math.floor(n/ys.length)]),
      rows:indices(ys[across ? Math.floor(n/xs.length) : n%ys.length]),scale}
  }}
}
