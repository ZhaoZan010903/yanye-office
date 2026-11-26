import {address,columnName,location} from './spreadsheet.js'

export const palettes={ink:['墨彩','#438979','#6386b4','#c68752','#987fae','#ad6371','#818d50'],ocean:['海蓝','#396591','#5fabb2','#8581b0','#bfd38a','#e8b96e','#bd778a']}

export function chartData(sheet,display) {
  const chart=sheet.chart
  const series=chart.series??[chart.col??1], labelCol=chart.labelCol??0
  let end=chart.end
  if(end==null) {
    end=1
    for(const ref of Object.keys(sheet.cells)) {
      const cell=location(ref)
      if(series.includes(cell.col)) end=Math.max(end,cell.row)
    }
    end=Math.min(end,20)
  }
  const start=chart.start??1
  const rows=Array.from({length:Math.max(0,end-start+1)},(_,i)=>start+i)
  const header=chart.header??Math.max(0,start-1)
  const colors=(palettes[chart.palette]??palettes.ink).slice(1)
  return {start,end,header,labelCol,rows,labels:rows.map(r=>String(display(sheet,address(r,labelCol)))),
    series:series.map((c,i)=>({col:c,title:String(display(sheet,address(header,c))||columnName(c)+' 列'),color:chart.colors?.[i]??colors[i%colors.length],
      values:rows.map(r=>{const v=display(sheet,address(r,c));return typeof v==='number' && Number.isFinite(v)?v:null})}))}
}

export function newChart(box) {
  const col=box.right
  if (box.top===box.bottom || box.left===box.right) return {col,series:[col],labelCol:0}
  if(box.right-box.left>6 || box.bottom-box.top>500) throw new Error('每张图表最多 6 个系列、500 个分类。')
  return {col,series:Array.from({length:box.right-box.left},(_,i)=>box.left+1+i),labelCol:box.left,header:box.top,start:box.top+1,end:box.bottom}
}
