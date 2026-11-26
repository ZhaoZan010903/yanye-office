import React, { useEffect, useMemo, useRef, useState } from 'react'
import { markdownFigures } from './markdown-figures.js'

let diagrams
async function drawDiagram(source) {
  diagrams ??= import('mermaid').then(({default:engine})=>{
    engine.initialize({startOnLoad:false, securityLevel:'strict', theme:'neutral', htmlLabels:false,
      flowchart:{htmlLabels:false}, suppressErrorRendering:true, maxTextSize:40000})
    return engine
  })
  if (/^\s*---|%%\s*\{/m.test(source)) throw new Error('此图含自定义渲染配置，可在源码中编辑。')
  const {svg}=await (await diagrams).render('yanye-'+crypto.randomUUID(),source)
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

export function Figure({ item }) {
  const host=useRef(null)
  const [result,setResult]=useState(null)
  useEffect(()=>{
    let active=true
    async function render() {
      if (item.source.length>40000) throw new Error('预览内容超过 40,000 字符。')
      if (item.kind==='mermaid') {
        const image=await drawDiagram(item.source)
        if (active) setResult({image})
      } else {
        const [{default:katex}]=await Promise.all([import('katex'),import('katex/dist/katex.min.css')])
        if (!active) return
        katex.render(item.source,host.current,{displayMode:item.kind!=='inline',trust:false,throwOnError:true,maxExpand:1000})
        setResult({})
      }
    }
    setResult(null)
    render().catch(e=>{ if(active)setResult({error:e.message}) })
    return ()=>{active=false}
  },[item.kind,item.source])
  const Box=item.kind==='inline'?'span':'div'
  return <Box className="md-figure-content">
    {!result && <span role="status">正在渲染…</span>}
    {result?.error && <span role="alert">{result.error}</span>}
    {result?.image && <img src={result.image} alt={'第 '+item.line+' 行的 Mermaid 图'}/>}
    <Box ref={host} className="md-math" hidden={item.kind==='mermaid' || Boolean(result?.error)}/>
  </Box>
}

export default function MarkdownFigures({ markdown, close }) {
  const items=useMemo(()=>markdownFigures(markdown),[markdown])
  const [index,setIndex]=useState(0)
  const current=Math.min(index,Math.max(0,items.length-1)), item=items[current]
  return <aside aria-label="公式与图表预览" className="md-figures">
    <div className="md-figure-controls"><strong>公式与图表</strong>
      {item && <select aria-label="预览对象" value={current} onChange={e=>setIndex(Number(e.target.value))}>
        {items.map((f,i)=><option key={i} value={i}>{i+1} · 第 {f.line} 行 · {f.kind==='mermaid'?'Mermaid':'公式'}</option>)}</select>}
      <button onClick={close}>关闭预览</button>
    </div>
    {item ? <Figure item={item}/> : <p>用一对 $$ 包围公式，或插入 mermaid 代码块后可在这里预览。</p>}
  </aside>
}
