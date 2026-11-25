import React, { useRef, useState } from 'react'
import { ArrowUpRight, Circle, Columns3, Diamond, Download, Hand, LayoutTemplate, Maximize, Minus, MousePointer2, Pencil, Plus,
  Redo2, Square, StickyNote, Trash2, Type, Undo2, Upload } from 'lucide-react'
import { addTemplate, boardBounds, connect, deleteObject, emptyBoard, endpoints, fitView, makeShape, mermaidFlow, moveObject,
  readBoard, shapeFills, shapeLines, shapeNames } from './canvas-model.js'
import './canvas.css'

const tools = [
  ['select', '选择', MousePointer2], ['pan', '平移', Hand], ['process', '流程步骤', Square],
  ['decision', '判断', Diamond], ['terminal', '起止', Circle], ['line', '连线', ArrowUpRight],
  ['note', '便签', StickyNote], ['text', '文本', Type], ['pen', '画笔', Pencil], ['lane', '泳道', Columns3],
]
const clamp = (n, min, max) => Math.max(min, Math.min(max, n))

function Shape({ node }) {
  const { x, y, w, h } = node
  if (node.type === 'lane') return <g data-canvas-id={node.id} data-node="" aria-label={node.label || '泳道'}>
    <rect x={x} y={y} width={w} height={h} fill={node.fill} stroke="#b6b3ad" />
    <rect x={x + 1} y={y + 1} width={w - 2} height={Math.min(27, h - 2)} fill="#efedea" />
    <text x={x + 8} y={y + 18} fontFamily="Segoe UI, Microsoft YaHei, sans-serif" fontSize="13" fill="#37352f">
      {shapeLines({ ...node, h: 24, w: w - 8 })[0]}</text>
  </g>
  const shape = { fill: node.fill, stroke: '#64625d', strokeWidth: 1.5 }
  const lines = shapeLines(node)
  return <g data-canvas-id={node.id} data-node="" aria-label={node.label || shapeNames[node.type]}>
    {node.type === 'decision'
      ? <polygon points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} {...shape} />
      : node.type === 'terminal'
        ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...shape} />
        : <rect x={x} y={y} width={w} height={h} rx={node.type === 'note' ? 0 : 4} {...shape}
          fill={node.type === 'text' ? 'transparent' : node.fill} stroke={node.type === 'text' ? 'none' : '#64625d'} />}
    <text textAnchor="middle" fill="#37352f" fontFamily="Segoe UI, Microsoft YaHei, sans-serif" fontSize="14" pointerEvents="none">
      {lines.map((line, i) => <tspan key={i} x={x + w / 2} y={y + h / 2 + (i - (lines.length - 1) / 2) * 18 + 5}>{line}</tspan>)}
    </text>
  </g>
}

function Edge({ edge, from, to }) {
  const [[x1, y1], [x2, y2]] = endpoints(from, to)
  const label = [...edge.label]
  return <g data-canvas-id={edge.id} aria-label={edge.label || '连接线'}>
    <line {...{ x1, y1, x2, y2 }} stroke="transparent" strokeWidth="14" />
    <line {...{ x1, y1, x2, y2 }} stroke="#595750" strokeWidth="1.6" markerEnd="url(#canvas-arrow)" />
    {label.length > 0 && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 7} fill="#37352f" fontSize="13"
      fontFamily="Segoe UI, Microsoft YaHei, sans-serif" textAnchor="middle" stroke="#ffffff" strokeWidth="3" paintOrder="stroke">
      {label.length > 20 ? label.slice(0, 20).join('') + '…' : edge.label}
    </text>}
  </g>
}

function Ink({ stroke }) {
  const first = stroke.points[0]
  if (stroke.points.length === 1) return <circle data-canvas-id={stroke.id} cx={first[0]} cy={first[1]} r="2" fill="#37352f" />
  const points = stroke.points.map(p => p.join(',')).join(' ')
  return <g data-canvas-id={stroke.id} fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points={points} stroke="transparent" strokeWidth="14" />
    <polyline points={points} stroke="#37352f" strokeWidth="2.5" />
  </g>
}

function exportSvg(svg, board) {
  const bounds = boardBounds(board)
  const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  root.setAttribute('viewBox', [bounds.x, bounds.y, bounds.width, bounds.height].join(' '))
  root.setAttribute('width', String(Math.ceil(bounds.width)))
  root.setAttribute('height', String(Math.ceil(bounds.height)))
  const bg = document.createElementNS(root.namespaceURI, 'rect')
  for (const [key, val] of Object.entries({ ...bounds, fill: '#ffffff' })) bg.setAttribute(key, String(val))
  const scene = svg.querySelector('[data-canvas-scene]').cloneNode(true)
  root.append(svg.querySelector('defs').cloneNode(true), bg, scene)
  return { xml: new XMLSerializer().serializeToString(root), bounds }
}

async function rasterize(xml, bounds) {
  const scale = Math.min(2, 4096 / Math.max(bounds.width, bounds.height))
  const width = Math.max(1, Math.round(bounds.width * scale)), height = Math.max(1, Math.round(bounds.height * scale))
  const scaled = new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement
  scaled.setAttribute('width', String(width))
  scaled.setAttribute('height', String(height))
  const image = new Image()
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(scaled))
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/png').split(',')[1]
}

function Action({ icon: Icon, label, ...props }) {
  return <button type="button" title={label} aria-label={label} {...props}><Icon size={16} aria-hidden="true" /></button>
}

export default function Canvas({ value, onChange, onImport, onExport }) {
  const board = value?.version === 1 && value.nodes ? value : emptyBoard
  const [tool, setTool] = useState('select')
  const [selected, select] = useState(null)
  const [source, setSource] = useState(null)
  const [draft, setDraft] = useState(null)
  const [fileMenu, setFileMenu] = useState(false)
  const [templates, setTemplates] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const svgRef = useRef(null), labelRef = useRef(null), gesture = useRef(null)
  const undo = useRef([]), redo = useRef([])
  const [historyTick, refreshHistory] = useState(0)
  const view = draft?.view ?? board.view
  const live = draft?.move ? moveObject(board, ...draft.move) : board
  const byId = new Map(live.nodes.map(n => [n.id, n]))
  const node = byId.get(selected)
  const edge = board.edges.find(e => e.id === selected)
  const stroke = board.strokes.find(s => s.id === selected)
  const count = board.nodes.length + board.strokes.length

  function commit(next, record = true) {
    if (next === board) return
    if (onChange(next) === false) return
    if (record) {
      undo.current = [...undo.current.slice(-29), board]
      redo.current = []
      refreshHistory(historyTick + 1)
    }
  }
  function stepHistory(backwards) {
    const [stack, other] = backwards ? [undo.current, redo.current] : [redo.current, undo.current]
    if (!stack.length || onChange(stack.at(-1)) === false) return
    stack.pop()
    other.push(board)
    select(null); setSource(null); refreshHistory(historyTick + 1)
  }
  function changeTool(next) {
    setTool(next); setSource(null); setFileMenu(false); setTemplates(false); svgRef.current.focus()
  }
  function screenPoint(event) {
    const rect = svgRef.current.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const world = p => ({ x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom })
  function insert(kind, point) {
    const n = makeShape(kind, point.x, point.y)
    commit({ ...board, nodes: [...board.nodes, n] })
    select(n.id); setTool('select')
  }
  function pointerDown(event) {
    if (event.button !== 0 && event.button !== 1 || gesture.current) return
    event.preventDefault()
    svgRef.current.focus()
    setFileMenu(false); setTemplates(false)
    const screen = screenPoint(event), p = world(screen)
    const id = event.target.closest('[data-canvas-id]')?.getAttribute('data-canvas-id') ?? null
    if (tool === 'pan' || event.button === 1) {
      gesture.current = { mode: 'pan', screen, view, pointerId: event.pointerId }
    } else if (tool === 'pen') {
      gesture.current = { mode: 'pen', stroke: { id: crypto.randomUUID(), points: [[p.x, p.y]] }, pointerId: event.pointerId }
      setDraft({ ink: gesture.current.stroke })
    } else if (Object.hasOwn(shapeNames, tool)) {
      insert(tool, p); return
    } else if (tool === 'line') {
      if (!byId.has(id) || byId.get(id).type === 'lane') return
      if (!source) { setSource(id); select(id) }
      else if (source !== id) {
        const next = connect(board, source, id)
        commit(next); select(next.edges.find(e => e.from === source && e.to === id)?.id)
        setSource(null); setTool('select')
      }
      return
    } else {
      select(id)
      if (!id || board.edges.some(e => e.id === id)) return
      gesture.current = { mode: 'move', id, screen, pointerId: event.pointerId }
    }
    svgRef.current.setPointerCapture(event.pointerId)
  }
  function updateGesture(event) {
    const g = gesture.current
    if (!g || g.pointerId !== event.pointerId) return
    const p = screenPoint(event)
    if (g.mode === 'pan') {
      g.nextView = { ...g.view, x: g.view.x + p.x - g.screen.x, y: g.view.y + p.y - g.screen.y }
      setDraft({ view: g.nextView })
    } else if (g.mode === 'move') {
      const dx = Math.round((p.x - g.screen.x) / view.zoom), dy = Math.round((p.y - g.screen.y) / view.zoom)
      g.move = [g.id, dx, dy]; setDraft({ move: g.move })
    } else {
      const pos = world(p), last = g.stroke.points.at(-1)
      if (Math.hypot(last[0] - pos.x, last[1] - pos.y) * view.zoom < 1.6) return
      g.stroke.points.push([Math.round(pos.x), Math.round(pos.y)])
      setDraft({ ink: g.stroke })
    }
  }
  function endGesture(event, cancel = false) {
    const g = gesture.current
    if (!g || event.pointerId !== g.pointerId) return
    if (!cancel) {
      updateGesture(event)
      if (g.mode === 'pan' && g.nextView) commit({ ...board, view: g.nextView }, false)
      if (g.mode === 'move' && g.move && (g.move[1] || g.move[2])) commit(moveObject(board, ...g.move))
      if (g.mode === 'pen') {
        commit({ ...board, strokes: [...board.strokes, g.stroke] }); select(g.stroke.id)
      }
    }
    gesture.current = null; setDraft(null)
  }
  function zoom(factor, point) {
    const start = world(point), scale = clamp(view.zoom * factor, .01, 4)
    commit({ ...board, view: { x: point.x - start.x * scale, y: point.y - start.y * scale, zoom: scale } }, false)
  }
  const center = () => ({ x: svgRef.current.clientWidth / 2, y: svgRef.current.clientHeight / 2 })
  function editSelected(patch) {
    const key = node ? 'nodes' : 'edges'
    commit({ ...board, [key]: board[key].map(item => item.id === selected ? { ...item, ...patch } : item) })
  }
  function remove() {
    commit(deleteObject(board, selected)); select(null); setSource(null)
  }
  function keyboard(event) {
    if (event.isComposing || event.nativeEvent.isComposing) return
    const { key } = event
    if (key === 'Escape') { changeTool('select'); select(null); return }
    if (event.ctrlKey || event.metaKey) {
      if (!['z','y'].includes(key.toLowerCase())) return
      event.preventDefault(); stepHistory(key.toLowerCase() === 'z' && !event.shiftKey); return
    }
    if (key === 'Delete' || key === 'Backspace') { event.preventDefault(); if (selected) remove(); return }
    if (key === 'Enter') {
      if (Object.hasOwn(shapeNames, tool)) insert(tool, world(center()))
      else { labelRef.current?.focus(); labelRef.current?.select() }
      event.preventDefault(); return
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0,-1], ArrowDown: [0,1] }
    if (arrows[key] && (node || stroke)) {
      event.preventDefault()
      const step = event.shiftKey ? 10 : 1
      commit(moveObject(board, selected, arrows[key][0] * step, arrows[key][1] * step))
    }
  }
  async function fileAction(format) {
    setFileMenu(false); setError(''); setBusy(true)
    try {
      if (format === 'import') {
        const file = await onImport('json')
        if (!file) return
        const imported = readBoard(file.text)
        commit(imported); select(null); setSource(null); setTool('select')
      } else if (format === 'json') {
        await onExport('画布.json', JSON.stringify(board))
      } else if (format === 'mmd') {
        await onExport('流程图.mmd', mermaidFlow(board))
      } else {
        const { xml, bounds } = exportSvg(svgRef.current, board)
        await onExport('画布.' + format, format === 'svg' ? xml : await rasterize(xml, bounds))
      }
    } catch (err) { setError(err.message || '画布文件处理失败。') }
    finally { setBusy(false) }
  }
  const toolHint = {
    select: '选择或拖动对象，双击图形编辑文字', pan: '拖动平移画布', line: source ? '点击终点图形' : '点击起点图形',
    pen: '按住并拖动绘制，Esc 返回选择',
  }[tool] ?? ('点击画布放置' + shapeNames[tool] + '，或按 Enter 居中插入')

  return <section className="yy-canvas" aria-label="流程图与白板">
    <div className="yy-canvas-bar" role="toolbar" aria-label="画布工具">
      {tools.map(([id, name, Icon]) => <Action key={id} icon={Icon} label={name} aria-pressed={tool === id} onClick={() => changeTool(id)} />)}
      <span className="yy-canvas-divider" />
      <Action icon={Undo2} label="撤销画布操作" disabled={!undo.current.length} onClick={() => stepHistory(true)} />
      <Action icon={Redo2} label="重做画布操作" disabled={!redo.current.length} onClick={() => stepHistory(false)} />
      <Action icon={Trash2} label="删除选中对象" disabled={!selected} onClick={remove} />
      <span className="yy-canvas-space" />
      <button type="button" aria-expanded={templates} onClick={() => { setTemplates(!templates); setFileMenu(false) }}><LayoutTemplate size={15} />模板</button>
      {templates && <div className="yy-canvas-files yy-canvas-templates" onKeyDown={e => { if (e.key === 'Escape') setTemplates(false) }}>
        {[['approval','审批流程'],['handoff','双泳道交接']].map(([kind, title]) => <button key={kind} onClick={() => {
          const next = addTemplate(board, kind)
          const added = next.nodes.slice(board.nodes.length)
          const view = fitView({ ...emptyBoard, nodes: added }, svgRef.current.clientWidth, svgRef.current.clientHeight)
          commit({ ...next, view }); changeTool('select'); select(added.find(n => n.type !== 'lane').id)
        }}>{title}</button>)}
      </div>}
      <button className="yy-canvas-file" disabled={busy} aria-expanded={fileMenu} onClick={() => { setFileMenu(!fileMenu); setTemplates(false) }}>
        <Download size={15} />文件
      </button>
      {fileMenu && <div className="yy-canvas-files" onKeyDown={e => { if (e.key === 'Escape') setFileMenu(false) }}>
        {['svg','png','json'].map(ext => <button key={ext} onClick={() => fileAction(ext)}>导出 {ext.toUpperCase()}</button>)}
        <button disabled={!board.nodes.length} onClick={() => fileAction('mmd')}>导出 Mermaid 流程图</button>
        <button onClick={() => fileAction('import')}><Upload size={14} />从 JSON 恢复画布</button>
      </div>}
    </div>
    <div className="yy-canvas-surface">
      <svg ref={svgRef} className={'yy-canvas-stage yy-canvas-tool-' + tool} tabIndex={0} role="group" aria-label="绘图画布"
        onPointerDown={pointerDown} onPointerMove={updateGesture} onPointerUp={endGesture}
        onPointerCancel={e => endGesture(e, true)} onLostPointerCapture={e => endGesture(e, true)} onKeyDown={keyboard}
        onDoubleClick={event => {
          if (tool === 'select' && event.target.closest('[data-canvas-id]')) { labelRef.current?.focus(); labelRef.current?.select() }
        }}
        onWheel={event => {
          if (gesture.current) return
          if (event.ctrlKey) zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12, screenPoint(event))
          else commit({ ...board, view: { ...view, x: view.x - (event.shiftKey ? event.deltaY : event.deltaX), y: view.y - (event.shiftKey ? 0 : event.deltaY) } }, false)
        }}>
        <defs><marker id="canvas-arrow" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
          <path d="M1,1 L9,5 L1,9" stroke="#595750" strokeWidth="1.6" fill="none" /></marker></defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          <g data-canvas-scene="">
            {live.nodes.filter(n => n.type === 'lane').map(n => <Shape key={n.id} node={n} />)}
            {live.edges.map(e => <g key={e.id} data-selected-edge={e.id === selected || undefined}><Edge edge={e} from={byId.get(e.from)} to={byId.get(e.to)} /></g>)}
            {live.nodes.filter(n => n.type !== 'lane').map(n => <Shape key={n.id} node={n} />)}
            {live.strokes.map(s => <g key={s.id} data-selected-ink={s.id === selected || undefined}><Ink stroke={s} /></g>)}
          </g>
          {draft?.ink && <Ink stroke={draft.ink} />}
          {node && <rect x={node.x - 4} y={node.y - 4} width={node.w + 8} height={node.h + 8} rx="2"
            fill="none" stroke="#2e7795" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        </g>
      </svg>
      {!count && !draft?.ink && <div className="yy-canvas-empty">
        <span>从一个流程步骤或一张便签开始</span>
        <button onClick={() => insert('process', world(center()))}>添加第一个步骤</button>
      </div>}
      <div className="yy-canvas-zoom">
        <Action icon={Minus} label="缩小画布" onClick={() => zoom(1 / 1.25, center())} />
        <span>{Math.round(view.zoom * 100)}%</span>
        <Action icon={Plus} label="放大画布" onClick={() => zoom(1.25, center())} />
        <Action icon={Maximize} label="适应全部图形" onClick={() => commit({ ...board, view: count ? fitView(board, svgRef.current.clientWidth, svgRef.current.clientHeight) : emptyBoard.view }, false)} />
      </div>
    </div>
    <div className="yy-canvas-props">
      {(node || edge) && <label>文字<input ref={labelRef} aria-label="对象文字" value={node?.label ?? edge.label} maxLength={4096}
        onChange={e => editSelected({ label: e.target.value })} /></label>}
      {node && <>
        <label>宽<input key={node.id + 'w' + node.w} aria-label="图形宽度" type="number" min="32" max="1600" defaultValue={node.w}
          onBlur={e => { const w = clamp(Number(e.target.value) || node.w, 32, 1600); if (w !== node.w) editSelected({ w }) }} /></label>
        <label>高<input key={node.id + 'h' + node.h} aria-label="图形高度" type="number" min="24" max="1200" defaultValue={node.h}
          onBlur={e => { const h = clamp(Number(e.target.value) || node.h, 24, 1200); if (h !== node.h) editSelected({ h }) }} /></label>
        {node.type !== 'text' && <label>填充<select value={node.fill} onChange={e => editSelected({ fill: e.target.value })}>
          {shapeFills.map((color, i) => <option key={color} value={color}>{['白色','米灰','淡黄','淡蓝','淡绿'][i]}</option>)}
        </select></label>}
      </>}
      <label>对象<select aria-label="选择画布对象" value={selected ?? ''} onChange={e => {
        const id = e.target.value || null
        if (tool === 'line' && id && byId.has(id) && byId.get(id).type !== 'lane') {
          if (source && source !== id) { commit(connect(board, source, id)); changeTool('select') }
          else setSource(id)
        }
        select(id); svgRef.current.focus()
      }}>
        <option value="">选择对象</option>
        {board.nodes.map((n, i) => <option key={n.id} value={n.id}>{i + 1}. {n.label || shapeNames[n.type]}</option>)}
        {board.edges.map((e, i) => <option key={e.id} value={e.id}>连线 {i + 1} {e.label}</option>)}
        {board.strokes.map((s, i) => <option key={s.id} value={s.id}>笔迹 {i + 1}</option>)}
      </select></label>
    </div>
    <div className="yy-canvas-status" role="status">{error || toolHint}<span>{board.nodes.length} 个图形 · {board.edges.length} 条连线</span></div>
  </section>
}
