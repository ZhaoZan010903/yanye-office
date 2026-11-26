import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { Figure } from './MarkdownFigures.jsx'
import { markdownFigures } from './markdown-figures.js'
import { editorSource } from './markdown-search.js'

function readingDocument(markdown) {
  const source=editorSource(markdown), items=markdownFigures(source), nonce=crypto.randomUUID()
  const parts=[]
  let end=0
  items.forEach((item,i)=>{
    parts.push(source.slice(end,item.from))
    const slot=' data-yanye-slot="'+nonce+'-'+i+'"'
    parts.push(item.kind==='inline' ? '<span'+slot+'></span>' : '\n\n<div'+slot+'></div>\n\n')
    end=item.to
  })
  parts.push(source.slice(end))
  const html=marked.parse(parts.join(''),{gfm:true,async:false})
  const clean=DOMPurify.sanitize(html,{
    RETURN_DOM_FRAGMENT:true,
    ALLOWED_TAGS:['p','br','hr','h1','h2','h3','h4','h5','h6','blockquote','strong','b','em','i','s','del','u','mark',
      'sub','sup','pre','code','ul','ol','li','table','thead','tbody','tr','th','td','a','img','input','details','summary','div','span','kbd'],
    ALLOWED_ATTR:['href','src','alt','title','align','start','type','checked','disabled','data-yanye-slot'],
    ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false,
  })
  for(const input of clean.querySelectorAll('input')) {
    if (input.type==='checkbox') input.disabled=true
    else input.remove()
  }
  const slots=[]
  for (const host of clean.querySelectorAll('[data-yanye-slot]')) {
    const id=host.dataset.yanyeSlot
    if (!id.startsWith(nonce+'-')) continue
    const index=Number(id.slice(nonce.length+1)), item=items[index]
    if (!item) continue
    host.className=item.kind==='inline'?'md-inline-slot':'md-block-slot'
    slots.push({host,item,index})
  }
  return {nodes:Array.from(clean.childNodes),slots}
}

export default function MarkdownReading({ markdown, edit, onLink }) {
  const host=useRef(null)
  const parsed=useMemo(()=>readingDocument(markdown),[markdown])
  const [visible,setVisible]=useState(()=>new Set())
  useLayoutEffect(()=>{
    const body=host.current
    const content=document.createDocumentFragment()
    for (const node of parsed.nodes) content.appendChild(node)
    body.replaceChildren(content)
    // Attach React previews only as their slots approach the document viewport.
    const byHost=new Map(parsed.slots.map(slot=>[slot.host,slot]))
    const observer=new IntersectionObserver(entries=>{
      setVisible(previous=>{
        const next=new Set(previous)
        for (const entry of entries) if (entry.isIntersecting) {
          const slot=byHost.get(entry.target)
          if (slot) next.add(slot)
          observer.unobserve(entry.target)
        }
        return next
      })
    },{root:body.closest('.document-scroll'),rootMargin:'180px'})
    setVisible(new Set())
    for (const el of byHost.keys()) observer.observe(el)
    return ()=>observer.disconnect()
  },[parsed])
  return <>
    <article aria-label="Markdown 阅读正文" className="writing-area md-reading" ref={host} tabIndex={-1}
      onClick={e=>{
        const link=e.target.closest('a[href]')
        if (!link) return
        e.preventDefault()
        if (/^https?:\/\//i.test(link.getAttribute('href'))) onLink(link.href)
      }}/>
    {[...visible].map(({host,item,index})=>createPortal(<>
      <Figure item={item}/>
      <button type="button" className="md-edit-figure" aria-label={'编辑第 '+item.line+' 行'+(item.kind==='mermaid'?'图表':'公式')+'源码'}
        onClick={()=>edit(item)}>{item.kind==='mermaid'?'编辑图表':'编辑公式'}</button>
    </>,host,index))}
  </>
}
