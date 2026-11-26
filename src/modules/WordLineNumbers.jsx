import React, {useEffect, useRef, useState} from 'react'
import {RibbonGroup} from '../office/Ribbon'
import './word-line-numbers.css'

function settings(layout) {
  const node=layout.nativeSection?.lnNumType
  if (!node) return null
  const attrs=node.attributes || {}
  return {mode:attrs.restart || 'newPage',interval:Number(attrs.countBy || 1),start:Number(attrs.start || 0)+1,
    gap:attrs.distance===undefined ? 8 : Number(attrs.distance)/15}
}

const modes={newSection:'每节重新编号',continuous:'连续编号',newPage:'每页重新编号'}

export function WordLineControls({layout, singleSection, changeLayout}) {
  const value=settings(layout)
  function change(attrs) {
    const nativeSection={...layout.nativeSection}
    if (attrs===null) delete nativeSection.lnNumType
    else nativeSection.lnNumType={tag:'lnNumType',attributes:{countBy:'1',...nativeSection.lnNumType?.attributes,...attrs}}
    changeLayout({nativeSection})
  }
  return <RibbonGroup label="行号"><div className="word-line-controls">
    <label>行号<select aria-label="本节行号" value={value?.mode || 'off'} onChange={e=>change(e.target.value==='off'?null:{restart:e.target.value})}>
      <option value="off">无</option><option value="newSection">{modes.newSection}</option>
      {(singleSection || value?.mode==='continuous') && <option value="continuous">{modes.continuous}</option>}
      {value && !['continuous','newSection'].includes(value.mode) && <option value={value.mode}>{modes[value.mode] || value.mode}（原文件）</option>}
    </select></label>
    {value && <label>间隔<input key={value.interval} type="number" aria-label="行号显示间隔" min="1" max="100" step="1" defaultValue={value.interval}
      onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} onBlur={e=>{
        if(e.target.checkValidity() && Number.isInteger(e.target.valueAsNumber)) change({countBy:e.target.value})
        else e.target.value=value.interval
      }}/></label>}
    {value && (value.mode==='newPage' || (!singleSection && value.mode==='continuous')) && <small>原文件跨页或跨节编号由 Word/WPS 排版</small>}
  </div></RibbonGroup>
}

// Sibling text runs with different marks can have different rectangle heights
// on one baseline. Count overlapping glyph bands only once within each block.
function paragraphRows(block,columnAt) {
  const rows=[],range=document.createRange()
  const walker=document.createTreeWalker(block,NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  for(let node=walker.nextNode();node;node=walker.nextNode()) {
    if(node.nodeType===Node.TEXT_NODE) range.selectNodeContents(node)
    else if(node.matches('br,img')) range.selectNode(node)
    else continue
    for(const rect of range.getClientRects()) {
      if(!rect.height) continue
      const col=columnAt(rect),last=rows.at(-1)
      const overlap=last && Math.min(last.bottom,rect.bottom)-Math.max(last.top,rect.top)
      if(last && last.col===col && overlap>=Math.min(last.bottom-last.top,rect.height)*.2) {
        last.top=Math.min(last.top,rect.top);last.bottom=Math.max(last.bottom,rect.bottom)
      } else rows.push({col,top:rect.top,bottom:rect.bottom})
    }
  }
  if(!rows.length) {
    const rect=block.getBoundingClientRect()
    if(rect.height) rows.push({col:columnAt(rect),top:rect.top,bottom:rect.bottom})
  }
  return rows
}

export function WordLineNumbers({editor,layout,sectionIndex,zoom}) {
  const value=settings(layout)
  const active=value && (value.mode==='newSection' || (value.mode==='continuous' && sectionIndex===1))
  const host=useRef(null)
  const [marks,setMarks]=useState([])
  const columns=layout.columns || 1
  useEffect(()=>{
    if(!active || !editor || !host.current) return
    const prose=editor.view.dom,overlay=host.current,sheet=overlay.parentElement
    let frame=0,live=true
    function measure() {
      frame=0
      const outer=overlay.getBoundingClientRect(),body=prose.getBoundingClientRect()
      const scale=zoom/100,gap=parseFloat(getComputedStyle(prose).columnGap)*scale || 0
      const pitch=(body.width+gap)/columns
      if(!pitch) {setMarks([]);return}
      const columnAt=rect=>Math.min(columns-1,Math.max(0,Math.floor((rect.left-body.left+1)/pitch)))
      let line=value.start
      const next=[]
      for(const block of prose.querySelectorAll('p,h1,h2,h3,h4,h5,h6,pre,table,img')) {
        if(!block.getClientRects().length || block.parentElement.closest('table') || (block.matches('img') && block.closest('p,h1,h2,h3,h4,h5,h6'))) continue
        const rows=block.matches('table,img') ? [block.getBoundingClientRect()].map(r=>({col:columnAt(r),top:r.top,bottom:r.bottom})) : paragraphRows(block,columnAt)
        for(const row of rows) {
          if(line % value.interval===0) next.push({line,x:(body.left+row.col*pitch-outer.left)/scale-value.gap,y:(row.top-outer.top)/scale})
          line++
        }
      }
      setMarks(next)
    }
    function schedule() {if(live && !frame) frame=requestAnimationFrame(measure)}
    const observer=new ResizeObserver(schedule)
    observer.observe(sheet);observer.observe(prose)
    const contents=new MutationObserver(schedule)
    contents.observe(prose,{subtree:true,childList:true,characterData:true,attributes:true})
    document.fonts.addEventListener('loadingdone',schedule)
    prose.addEventListener('load',schedule,true)
    schedule()
    return ()=>{live=false;cancelAnimationFrame(frame);observer.disconnect();contents.disconnect();document.fonts.removeEventListener('loadingdone',schedule);prose.removeEventListener('load',schedule,true)}
  },[editor,active,sectionIndex,zoom,columns,value?.interval,value?.start,value?.gap,layout.top,layout.left,layout.right,layout.bottom,layout.columnGap])
  if(!active) return null
  return <div ref={host} aria-hidden="true" className="word-line-numbers">{marks.map(mark=><span key={mark.line}
    style={{top:mark.y,right:'calc(100% - '+mark.x+'px)'}}>{mark.line}</span>)}</div>
}
