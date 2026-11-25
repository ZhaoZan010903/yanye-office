export const shapeNames = { process: '流程步骤', decision: '判断', terminal: '起止', note: '便签', text: '文本', lane: '泳道' }
export const shapeFills = ['#ffffff', '#f7f6f3', '#fbf1c9', '#e5eff7', '#e6f1e8']
export const emptyBoard = { version: 1, nodes: [], edges: [], strokes: [], view: { x: 0, y: 0, zoom: 1 } }

export function makeShape(type, x, y) {
  const w = { decision: 180, lane: 510 }[type] ?? 156
  const h = { process: 64, decision: 96, terminal: 56, note: 120, text: 48, lane: 160 }[type]
  return {
    id: crypto.randomUUID(), type, label: shapeNames[type], x: Math.round(x - w / 2), y: Math.round(y - h / 2),
    w, h, fill: type === 'note' ? '#fbf1c9' : '#ffffff',
  }
}

export function connect(board, from, to) {
  if (from === to || ![from, to].every(id => board.nodes.some(node => node.id === id && node.type !== 'lane'))) return board
  if (board.edges.some(edge => edge.from === from && edge.to === to)) return board
  return { ...board, edges: [...board.edges, { id: crypto.randomUUID(), from, to, label: '' }] }
}

export function deleteObject(board, id) {
  if (!id) return board
  return { ...board, nodes: board.nodes.filter(node => node.id !== id),
    edges: board.edges.filter(edge => edge.id !== id && edge.from !== id && edge.to !== id),
    strokes: board.strokes.filter(stroke => stroke.id !== id) }
}

export function moveObject(board, id, dx, dy) {
  const lane = board.nodes.find(n => n.id === id && n.type === 'lane')
  function inside(x, y) {
    return lane && x >= lane.x && x <= lane.x + lane.w && y >= lane.y && y <= lane.y + lane.h
  }
  return { ...board, nodes: board.nodes.map(n => n.id === id || (n.type !== 'lane' && inside(n.x + n.w / 2, n.y + n.h / 2))
    ? { ...n, x: n.x + dx, y: n.y + dy } : n),
    strokes: board.strokes.map(s => s.id === id || (lane && s.points.every(([x, y]) => inside(x, y)))
      ? { ...s, points: s.points.map(([x, y]) => [x + dx, y + dy]) } : s) }
}

function port(node, dx, dy) {
  const scaleX = Math.abs(dx) * 2 / node.w
  const scaleY = Math.abs(dy) * 2 / node.h
  let distance = Math.max(scaleX, scaleY)
  if (node.type === 'decision') distance = scaleX + scaleY
  if (node.type === 'terminal') distance = Math.hypot(scaleX, scaleY)
  const ratio = distance ? 1 / distance : 0
  return [node.x + node.w / 2 + dx * ratio, node.y + node.h / 2 + dy * ratio]
}

export function endpoints(from, to) {
  const dx = to.x + to.w / 2 - from.x - from.w / 2
  const dy = to.y + to.h / 2 - from.y - from.h / 2
  return [port(from, dx, dy), port(to, -dx, -dy)]
}

export function boardBounds(board) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  function include(x, y) {
    left = Math.min(left, x)
    right = Math.max(right, x)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  for (const node of board.nodes) {
    include(node.x, node.y)
    include(node.x + node.w, node.y + node.h)
  }
  for (const stroke of board.strokes) for (const [x, y] of stroke.points) include(x, y)
  const byId = new Map(board.nodes.map(node => [node.id, node]))
  for (const edge of board.edges) {
    if (!edge.label) continue
    const [a, b] = endpoints(byId.get(edge.from), byId.get(edge.to))
    const midX = (a[0] + b[0]) / 2, midY = (a[1] + b[1]) / 2
    const labelWidth = Math.min(21, [...edge.label].length) * 13
    include(midX - labelWidth / 2, midY - 24)
    include(midX + labelWidth / 2, midY)
  }
  if (!Number.isFinite(left)) return { x: 0, y: 0, width: 640, height: 360 }
  return { x: left - 24, y: top - 24, width: right - left + 48, height: bottom - top + 48 }
}

export function fitView(board, width, height) {
  const b = boardBounds(board)
  const zoom = Math.max(.01, Math.min(1.2, width / b.width, height / b.height))
  return { zoom, x: (width - b.width * zoom) / 2 - b.x * zoom, y: (height - b.height * zoom) / 2 - b.y * zoom }
}

export function readBoard(source) {
  const data = JSON.parse(source)
  const ids = new Set()
  const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 80 && !ids.has(id) && ids.add(id)
  const coord = n => Number.isFinite(n) && Math.abs(n) <= 100_000_000
  const label = text => typeof text === 'string' && text.length <= 4096
  if (data?.version !== 1 || ![data.nodes, data.edges, data.strokes].every(Array.isArray)) throw Error('请选择砚页导出的画布 JSON。')
  for (const n of data.nodes) {
    if (!n || !validId(n.id) || !Object.hasOwn(shapeNames, n.type) || ![n.x, n.y, n.w, n.h].every(coord)
        || n.w < 32 || n.h < 24 || !label(n.label) || !shapeFills.includes(n.fill)) throw Error('画布包含无效图形。')
  }
  const nodeIds = new Set(ids)
  for (const e of data.edges) {
    if (!e || !validId(e.id) || !nodeIds.has(e.from) || !nodeIds.has(e.to) || !label(e.label)) throw Error('画布包含无效连线。')
  }
  for (const s of data.strokes) {
    if (!s || !validId(s.id) || !Array.isArray(s.points) || !s.points.length ||
        !s.points.every(p => Array.isArray(p) && p.length === 2 && p.every(coord))) throw Error('画布包含无效笔迹。')
  }
  const view = data.view
  if (!view || ![view.x, view.y, view.zoom].every(coord) || view.zoom <= 0 || view.zoom > 4) throw Error('无效的画布视口。')
  return { version: 1, nodes: data.nodes, edges: data.edges, strokes: data.strokes, view }
}

export function shapeLines(node) {
  const width = node.w * (node.type === 'decision' ? .55 : .86)
  const maxLines = Math.max(1, Math.floor(node.h * (node.type === 'decision' ? .55 : .9) / 18))
  const lines = []
  let line = '', advance = 0
  for (const char of node.label) {
    const size = char.codePointAt(0) > 255 ? 14 : 8
    if (char === '\n' || (line && advance + size > width)) {
      lines.push(line)
      line = ''
      advance = 0
      if (char === '\n') continue
    }
    line += char
    advance += size
  }
  lines.push(line)
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = [...lines[maxLines - 1]].slice(0, -1).join('') + '…'
  }
  return lines
}

export function addTemplate(board, kind) {
  const bounds = boardBounds(board)
  const x = board.nodes.length || board.strokes.length ? bounds.x + bounds.width + 40 : 24
  const y = board.nodes.length || board.strokes.length ? bounds.y + 24 : 24
  const nodes = [], edges = []
  function node(type, label, left, top, width, height) {
    const n = { ...makeShape(type, 0, 0), label, x: x + left, y: y + top }
    if (width) n.w = width
    if (height) n.h = height
    nodes.push(n)
    return n
  }
  function link(from, to, label = '') { edges.push({ id: crypto.randomUUID(), from: from.id, to: to.id, label }) }
  if (kind === 'handoff') {
    node('lane', '发起方', 0, 0, 640, 142)
    node('lane', '承接方', 0, 162, 640, 142)
    const a = node('process', '提交资料', 28, 52)
    const b = node('process', '接收并核对', 236, 214)
    const c = node('terminal', '交付结果', 445, 214)
    link(a,b); link(b,c)
  } else {
    const a = node('process', '发起申请', 0, 70)
    const b = node('decision', '审批通过？', 216, 54)
    const c = node('terminal', '完成', 470, 10)
    const d = node('process', '修改并重提', 470, 155)
    link(a,b); link(b,c,'是'); link(b,d,'否')
  }
  return { ...board, nodes: [...board.nodes, ...nodes], edges: [...board.edges, ...edges] }
}

export function mermaidFlow(board) {
  // Generated identifiers isolate editable labels from Mermaid syntax.
  const names = new Map(board.nodes.map((n, i) => [n.id, 'N' + (i + 1)]))
  const label = value => [...value.replace(/\s+/gu, ' ')].map(c => /[\p{L}\p{M}\p{N} ]/u.test(c) ? c : '#' + c.codePointAt(0) + ';').join('')
  const lines = ['flowchart LR']
  const lanes = board.nodes.filter(n => n.type === 'lane')
  const grouped = new Map([[null, []], ...lanes.map(lane => [lane.id, []])])
  for (const n of board.nodes.filter(n => n.type !== 'lane')) {
    const centerX = n.x + n.w / 2, centerY = n.y + n.h / 2
    const parent = lanes.find(l => centerX >= l.x && centerX <= l.x + l.w && centerY >= l.y && centerY <= l.y + l.h)
    const text = '"' + label(n.label || shapeNames[n.type]) + '"'
    const shape = n.type === 'decision' ? '{' + text + '}' : n.type === 'terminal' ? '([' + text + '])' : '[' + text + ']'
    grouped.get(parent?.id ?? null).push('  ' + names.get(n.id) + shape)
  }
  lines.push(...grouped.get(null))
  for (const lane of lanes) {
    lines.push('  subgraph ' + names.get(lane.id) + ' ["' + label(lane.label || '泳道') + '"]', ...grouped.get(lane.id), '  end')
  }
  for (const e of board.edges) lines.push('  ' + names.get(e.from) + ' -->' + (e.label ? '|"' + label(e.label) + '"|' : '') + ' ' + names.get(e.to))
  return lines.join('\n') + '\n'
}
