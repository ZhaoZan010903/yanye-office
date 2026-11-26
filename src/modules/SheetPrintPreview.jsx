import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import {createPortal,flushSync} from 'react-dom'
import {ChevronLeft,ChevronRight,FileDown,Printer,X} from 'lucide-react'
import {address,columnName,conditionalFill,conditionRules,formatted} from './spreadsheet.js'
import {printLayout} from './sheet-print.js'
import {paperSizes} from './sheet-page.js'
import {cellBorders} from './sheet-borders.js'
import './sheet-print.css'

const maxBatchPages=50,maxBatchCells=120000
const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve))
function cellCount(page,headers){
  return (page.rows.length+Number(headers))*(page.cols.length+Number(headers))
}

function PrintedPage({sheet,display,layout,index,rules}) {
  const page=layout.pageAt(index),setup=sheet.pageSetup || {},m=layout.margins
  const x=page.cols,y=page.rows,covered=new Set(),merged=new Map()
  for(const box of sheet.merges || []) {
    const cols=x.filter(c=>c>=box.left && c<=box.right),rows=y.filter(r=>r>=box.top && r<=box.bottom)
    if(!cols.length || !rows.length) continue
    for(const r of rows) for(const c of cols) covered.add(address(r,c))
    const ref=address(rows[0],cols[0])
    covered.delete(ref); merged.set(ref,{source:address(box.top,box.left),width:cols.length,height:rows.length})
  }
  const tableWidth=x.reduce((n,c)=>n+layout.cols.size(c),setup.showRowColHeaders?40:0)
  return <article className="sheet-print-page" aria-label={'打印第 '+(index+1)+' 页'} style={{width:layout.widthMm+'mm',height:layout.heightMm+'mm',
    padding:[m.top,m.right,m.bottom,m.left].map(n=>n+'in').join(' '),alignItems:setup.horizontalCentered?'center':'flex-start',justifyContent:setup.verticalCentered?'center':'flex-start',
    filter:setup.blackAndWhite?'grayscale(1)':undefined}}>
    <div className="sheet-print-content" style={{zoom:page.scale}}><table style={{width:tableWidth}} data-lines={!!setup.showGridLines}>
      <colgroup>{setup.showRowColHeaders && <col style={{width:40}}/>}{x.map(c=><col key={c} style={{width:layout.cols.size(c)}}/>)}</colgroup>
      {setup.showRowColHeaders && <thead><tr><th/>{x.map(c=><th key={c}>{columnName(c)}</th>)}</tr></thead>}
      <tbody>{y.map(r=><tr key={r} style={{height:layout.rows.size(r)}}>{setup.showRowColHeaders && <th>{r+1}</th>}{x.map(c=>{
        const pos=address(r,c)
        if(covered.has(pos)) return null
        const merge=merged.get(pos),ref=merge?.source || pos,style=sheet.styles?.[ref] || {},value=display(sheet,ref)
        return <td key={c} data-ref={ref} rowSpan={merge?.height} colSpan={merge?.width} style={{fontFamily:style.font,fontSize:(style.size || 11)+'pt',
          fontStyle:style.italic?'italic':undefined,fontWeight:style.bold?700:undefined,color:style.color,backgroundColor:conditionalFill(rules,r,c,value) || style.fill,
          textAlign:style.align || (typeof value==='number'?'right':undefined),verticalAlign:style.vertical || 'bottom',whiteSpace:style.wrap?'pre-wrap':'pre',
          textDecoration:[style.underline && 'underline',style.strike && 'line-through'].filter(Boolean).join(' '),paddingLeft:style.indent?style.indent*10:undefined,...cellBorders(style.borders)}}>
          {formatted(value,sheet.formats?.[ref])}</td>
      })}</tr>)}</tbody></table></div>
  </article>
}

export default function SheetPrintPreview({sheet,display,close,onPrintPdf}) {
  const result=useMemo(()=>{try{return {layout:printLayout(sheet)}}catch(e){return {error:e.message}}},[sheet])
  const layout=result.layout, [index,setIndex]=useState(0),[zoom,setZoom]=useState(.68)
  const [pages,setPages]=useState(null),[error,setError]=useState('')
  const [scope,setScope]=useState('current'),[from,setFrom]=useState('1'),[to,setTo]=useState('1')
  const printing=pages!==null,finishSystem=useRef(null),busy=useRef(false),output=useRef(null)
  const viewport=useRef(null),dialog=useRef(null),exit=useRef(null)
  const previewFits=layout && cellCount(layout.pageAt(index),!!sheet.pageSetup?.showRowColHeaders)<=maxBatchCells
  const rules=useMemo(()=>conditionRules(sheet),[sheet.conditions])
  useLayoutEffect(()=>{
    if(!layout || !viewport.current)return
    const observer=new ResizeObserver(([{contentRect:r}])=>setZoom(Math.max(.15,Math.min(1,(r.width-36)/(layout.widthMm*96/25.4),(r.height-24)/(layout.heightMm*96/25.4)))))
    observer.observe(viewport.current);return ()=>observer.disconnect()
  },[layout])
  useEffect(()=>{
    const previous=document.activeElement
    exit.current.focus()
    return ()=>{finishSystem.current?.();previous?.focus()}
  },[])
  function systemPrint(){
    return new Promise((resolve,reject)=>{
      const media=window.matchMedia('print')
      function done(){
        window.removeEventListener('afterprint',done)
        media.removeEventListener('change',changed)
        finishSystem.current=null
        resolve()
      }
      function changed(event){if(!event.matches)done()}
      finishSystem.current=done
      window.addEventListener('afterprint',done)
      media.addEventListener('change',changed)
      try{window.print()}catch(e){window.removeEventListener('afterprint',done);media.removeEventListener('change',changed);finishSystem.current=null;reject(e)}
    })
  }
  async function print(pdf){
    if(busy.current)return
    setError('')
    const start=scope==='current'?index+1:Number(from),end=scope==='current'?index+1:Number(to)
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>layout.count){
      setError('请输入 1 至 '+layout.count+' 之间的连续页码，末页应大于或等于首页。');return
    }
    if(end-start+1>maxBatchPages){setError('单次最多 '+maxBatchPages+' 页，请分批输出。');return}
    const selected=Array.from({length:end-start+1},(_,i)=>start+i-1)
    let cells=0
    for(const page of selected){
      cells+=cellCount(layout.pageAt(page),!!sheet.pageSetup?.showRowColHeaders)
      if(cells>maxBatchCells){setError('本批超过 '+maxBatchCells.toLocaleString()+' 个打印网格，请缩小页码范围或打印区域。');return}
    }
    busy.current=true
    try{
      flushSync(()=>setPages(selected))
      await nextFrame()
      await document.fonts.ready
      await nextFrame()
      if(!output.current?.isConnected)return
      if(pdf){
        const range=start===end?String(start):start+'-'+end
        await onPrintPdf(sheet.name+'-第'+range+'页.pdf',{widthMm:layout.widthMm,heightMm:layout.heightMm})
      }else await systemPrint()
    }
    catch(e){setError(e.message || String(e))}
    finally {busy.current=false;setPages(null)}
  }
  return createPortal(<section className="sheet-print-dialog" role="dialog" aria-modal="true" aria-label="打印预览" ref={dialog} onKeyDown={e=>{
    if(e.key==='Escape' && !printing){e.preventDefault();close()}
    if(e.key==='Tab'){
      const buttons=[...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')]
      const [first,last]=[buttons[0],buttons.at(-1)]
      if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus()}
      if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus()}
    }
  }}>
    <header><strong>打印预览</strong><span>{sheet.name} · {paperSizes[sheet.pageSetup?.paperSize] || 'A4'} · {sheet.pageSetup?.orientation==='landscape'?'横向':'纵向'}</span>
      <button ref={exit} disabled={printing} onClick={close}><X size={15}/>关闭预览</button></header>
    {(error || result.error) && <p role="alert">{error || result.error}</p>}
    {layout && <><div className="sheet-print-view" ref={viewport}><div className="sheet-print-zoom" style={{zoom}}>
      {previewFits?<PrintedPage sheet={sheet} display={display} layout={layout} index={index} rules={rules}/>:<p role="status">本页网格超过 {maxBatchCells.toLocaleString()}，请调整打印缩放或打印区域。</p>}</div></div>
      {pages && <div className="sheet-print-batch" ref={output} aria-hidden="true">{pages.map(p=><PrintedPage key={p} sheet={sheet} display={display} layout={layout} index={p} rules={rules}/>)}</div>}
      <footer><button aria-label="上一页" disabled={!index || printing} onClick={()=>setIndex(index-1)}><ChevronLeft size={16}/></button>
        <label>第 <input disabled={printing} aria-label="打印页码" type="number" min="1" max={layout.count} key={index} defaultValue={index+1}
          onKeyDown={e=>{if(e.key==='Enter')e.target.blur()}} onBlur={e=>{const n=Math.max(1,Math.min(layout.count,Math.trunc(Number(e.target.value)) || 1));e.target.value=n;setIndex(n-1)}}/> / {layout.count} 页</label>
        <button aria-label="下一页" disabled={index===layout.count-1 || printing} onClick={()=>setIndex(index+1)}><ChevronRight size={16}/></button>
        <label>输出范围 <select value={scope} disabled={printing} onChange={e=>{setScope(e.target.value);setFrom(String(index+1));setTo(String(index+1));setError('')}}>
          <option value="current">本页</option><option value="range">连续页码</option></select></label>
        {scope==='range' && <><label>从 <input aria-label="起始页" type="number" min="1" max={layout.count} value={from} disabled={printing} onChange={e=>setFrom(e.target.value)}/></label>
          <label>至 <input aria-label="结束页" type="number" min="1" max={layout.count} value={to} disabled={printing} onChange={e=>setTo(e.target.value)}/></label>
          <small>每批最多 {maxBatchPages} 页、{maxBatchCells.toLocaleString()} 个网格</small></>}
        <button disabled={printing} onClick={()=>print(false)}><Printer size={15}/>{scope==='current'?'打印本页':'打印选定页'}</button>
        {onPrintPdf && <button disabled={printing} onClick={()=>print(true)}><FileDown size={15}/>{scope==='current'?'本页导出 PDF':'选定页导出 PDF'}</button>}</footer>
      <style>{'@media print { @page {size:'+layout.widthMm+'mm '+layout.heightMm+'mm;margin:0} }'}</style></>}
  </section>,document.body)
}
