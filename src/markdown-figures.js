// Collect renderable constructs without treating code examples as formulas.
export function markdownFigures(markdown) {
  // Offsets match the textarea, which always represents a line break as LF.
  const source=markdown.replace(/\r\n?/g,'\n')
  const lines=source.split('\n')
  const figures=[]
  let fence=null, math=null, next=0
  const block=(open,start,end)=> {
    const bodyEnd=Math.max(open.bodyStart,start-1)
    figures.push({kind:open.kind,line:open.line,source:source.slice(open.bodyStart,bodyEnd),
      from:open.from,to:end,bodyStart:open.bodyStart,bodyEnd})
  }
  for (let i=0; i<lines.length; i++) {
    const line=lines[i], trimmed=line.trim()
    const start=next, end=start+line.length
    next=end+1
    if (fence) {
      if (fence.close.test(line)) {
        if (fence.kind) block(fence,start,end)
        fence=null
      }
      continue
    }
    if (math) {
      if (trimmed==='$$') {block(math,start,end);math=null}
      continue
    }
    const begin=/^ {0,3}(`{3,}|~{3,})\s*([^\s]*)/.exec(line)
    if (begin) {
      const lang=begin[2].toLowerCase()
      fence={close:new RegExp('^ {0,3}'+begin[1][0]+'{'+begin[1].length+',}\\s*$'),line:i+1,from:start,bodyStart:next,
        kind:lang==='mermaid'?'mermaid':['math','latex'].includes(lang)?'math':null}
      continue
    }
    if (trimmed==='$$') {math={kind:'math',line:i+1,from:start,bodyStart:next};continue}
    if (/^\$\$.+\$\$$/.test(trimmed)) {
      const bodyStart=start+line.indexOf('$$')+2, bodyEnd=bodyStart+trimmed.length-4
      figures.push({kind:'math',line:i+1,source:source.slice(bodyStart,bodyEnd),from:start,to:end,bodyStart,bodyEnd})
      continue
    }
    const visible=line.replace(/(`+)(.*?)\1/g, m=>' '.repeat(m.length))
    const single=/(?<![\\$])\$(?![\s$])([^$\n]+?)(?<![\\\s])\$(?![\d$])/g
    for (const match of visible.matchAll(single)) {
      const from=start+match.index, to=from+match[0].length
      figures.push({kind:'inline',line:i+1,source:source.slice(from+1,to-1),from,to,bodyStart:from+1,bodyEnd:to-1})
    }
  }
  return figures
}
