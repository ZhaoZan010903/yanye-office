// The public js-sequence-diagrams DSL used by Typora is distinct from Mermaid.
// Use DOM text nodes for labels, including user-supplied Chinese and punctuation.
type Arrow = { kind: 'arrow'; from: number; to: number; line: string; text: string }
type Note = { kind: 'note'; side: string; from: number; to: number; text: string }

function sequence(source: string) {
  const actors: string[] = [], aliases = new Map<string, number>(), rows: (Arrow | Note)[] = []
  let title = ''
  function actor(key: string, label = key) {
    key = key.trim()
    if (!key) throw Error('参与者名称为空。')
    if (!aliases.has(key)) { aliases.set(key, actors.length); actors.push(label.trim()) }
    return aliases.get(key)!
  }
  for (const [index, raw] of source.split('\n').entries()) {
    const s = raw.trim(), unescape = (v: string) => v.trim().replace(/\\n/g, '\n')
    if (!s || s.startsWith('#')) continue
    const heading = /^title\s*:\s*(.*)$/iu.exec(s)
    const participant = /^participant\s+(.+?)(?:\s+as\s+(\S+))?$/iu.exec(s)
    const note = /^note\s+(left of|right of|over)\s+([^,:]+?)(?:\s*,\s*([^:]+))?\s*:(.*)$/iu.exec(s)
    const arrow = /^(.+?)\s*(--?(?:>>|>)?)\s*([^:]+?)\s*:(.*)$/u.exec(s)
    if (heading) title = unescape(heading[1])
    else if (participant) actor(participant[2] ?? participant[1], unescape(participant[1]))
    else if (note && (!note[3] || note[1].toLowerCase() === 'over')) {
      const from = actor(note[2]), to = note[3] ? actor(note[3]) : from
      rows.push({kind:'note', side:note[1].toLowerCase(), from, to, text:unescape(note[4])})
    } else if (arrow) rows.push({kind:'arrow', from:actor(arrow[1]), to:actor(arrow[3]), line:arrow[2], text:unescape(arrow[4])})
    else throw Error('时序图第 ' + (index + 1) + ' 行语法无效。')
  }
  if (!actors.length) throw Error('请先写入参与者或消息。')
  return { actors, rows, title }
}

export function sequenceSvg(source: string) {
  const { actors, rows, title } = sequence(source)
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  const font = 'ui-monospace, Consolas, "Microsoft YaHei", monospace'
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.font = '14px ' + font
  function dims(text: string) {
    const lines = text.split('\n')
    return { w: Math.max(...lines.map(s => ctx.measureText(s).width)) + 20, h: lines.length * 19 + 10 }
  }
  function shape(tag: string, attrs: Record<string, string | number>) {
    const el = document.createElementNS(ns, tag)
    Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, String(v)))
    svg.append(el)
    return el
  }
  function text(x: number, y: number, value: string) {
    const el = shape('text', {x, y, fill:'#37352f', 'text-anchor':'middle', 'font-size':14, 'font-family':font})
    for (const [i, line] of value.split('\n').entries()) {
      const span = document.createElementNS(ns, 'tspan')
      span.setAttribute('x', String(x)); span.setAttribute('dy', i ? '19' : '0')
      span.textContent = line; el.append(span)
    }
  }
  function box(x: number, y: number, value: string, w: number, h: number, fill = '#fff') {
    shape('rect', {x:x-w/2, y, width:w, height:h, fill, stroke:'#37352f', 'stroke-width':1.4})
    text(x, y + (h - dims(value).h)/2 + 20, value)
  }
  const sizes = actors.map(dims)
  const before = sizes.map(s => s.w/2), after = [...before]
  const constraints: {left:number; width:number}[][] = actors.map(()=>[])
  for (const row of rows) {
    const w = dims(row.text).w
    if (row.kind === 'note') {
      if (row.side === 'left of') before[row.from] = Math.max(before[row.from], w + 10)
      else if (row.side === 'right of') after[row.from] = Math.max(after[row.from], w + 10)
      else {
        before[Math.min(row.from,row.to)] = Math.max(before[Math.min(row.from,row.to)], w/2)
        after[Math.max(row.from,row.to)] = Math.max(after[Math.max(row.from,row.to)], w/2)
      }
    } else if (row.from === row.to) after[row.from] = Math.max(after[row.from], w + 28)
    else constraints[Math.max(row.from,row.to)].push({left:Math.min(row.from,row.to),width:w+16})
  }
  const x = [before[0] + 12]
  for (let i=1; i<actors.length; i++) {
    x[i] = x[i-1] + after[i-1] + before[i] + 32
    for (const span of constraints[i]) x[i] = Math.max(x[i], x[span.left]+span.width)
  }
  const w = Math.max(x.at(-1)! + after.at(-1)! + 12, title ? dims(title).w + 24 : 0)
  let y = 10
  if (title) { const size = dims(title); text(w/2, y + 16, title); y += size.h + 9 }
  const head = Math.max(...sizes.map(size => size.h))
  const start = y + head
  const bottom = rows.reduce((total, row) => total + dims(row.text).h + (row.kind === 'arrow' && row.from === row.to ? 32 : 15), start + 14)
  for (const [i, name] of actors.entries()) {
    box(x[i],y,name,sizes[i].w,head)
    shape('line',{x1:x[i],x2:x[i],y1:start,y2:bottom,stroke:'#716f68','stroke-dasharray':'5 4'})
    box(x[i],bottom,name,sizes[i].w,head)
  }
  y = start + 9
  for (const row of rows) {
    const size = dims(row.text), a = x[row.from], b = x[row.to]
    if (row.kind === 'note') {
      const center = row.side === 'left of' ? a-size.w/2-10 : row.side === 'right of' ? a+size.w/2+10 : (a+b)/2
      box(center,y,row.text,size.w,size.h,'#f7f6f3')
    } else {
      const self = a === b, end = y+size.h+(self ? 20 : 0), direction = self || a > b ? -1 : 1
      text(self ? a+size.w/2+12 : (a+b)/2,y+15,row.text)
      const d = self ? 'M '+a+' '+(end-18)+' h 24 v 18 H '+a : 'M '+a+' '+end+' H '+b
      shape('path',{d, fill:'none',stroke:'#37352f','stroke-width':1.5,'stroke-dasharray':row.line.startsWith('--')?'5 3':'none'})
      if (row.line.includes('>')) {
        const tip = 'M '+(b-8*direction)+' '+(end-4)+' L '+b+' '+end+' L '+(b-8*direction)+' '+(end+4)
        shape('path',{d:tip,fill:row.line.endsWith('>>')?'none':'#37352f',stroke:'#37352f','stroke-width':1.5})
      }
    }
    y += size.h + (row.kind === 'arrow' && a === b ? 32 : 15)
  }
  svg.setAttribute('viewBox', '0 0 '+Math.ceil(w)+' '+Math.ceil(bottom+head+10))
  svg.setAttribute('width', String(Math.ceil(w))); svg.setAttribute('height', String(Math.ceil(bottom+head+10)))
  return new XMLSerializer().serializeToString(svg)
}
