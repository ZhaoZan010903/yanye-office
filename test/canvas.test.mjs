import assert from 'node:assert/strict'
import test from 'node:test'
import { addTemplate, boardBounds, connect, deleteObject, emptyBoard, endpoints, fitView, makeShape, mermaidFlow, moveObject, readBoard, shapeLines } from '../src/modules/canvas-model.js'

test('drawing edges follow moved shapes and delete with their endpoints', () => {
  const from = makeShape('process', 120, 160), to = makeShape('decision', 420, 160)
  const drawing = connect({ ...emptyBoard, nodes: [from, to] }, from.id, to.id)
  const duplicate = connect(drawing, from.id, to.id)
  assert.equal(duplicate, drawing)
  assert.deepEqual(endpoints(from, to), [[198,160], [330,160]])
  const moved = moveObject(drawing, to.id, 100, 0)
  assert.deepEqual(endpoints(...moved.nodes), [[198,160], [430,160]])
  const reopened = readBoard(JSON.stringify(moved))
  assert.deepEqual(reopened, moved)
  assert.deepEqual(deleteObject(reopened, to.id).edges, [])
})

test('whiteboard bounds include off-screen ink, invalid references are rejected', () => {
  const s = { id: 'ink1', points: [[-900,-120],[250,410]] }
  const board = { ...emptyBoard, strokes: [s] }
  const box = boardBounds(board)
  assert.equal(box.width, 1198)
  assert.ok(fitView(board, 400, 360).zoom < 1)
  assert.deepEqual(moveObject(board, s.id, 20, 30).strokes[0].points, [[-880,-90],[270,440]])
  assert.throws(() => readBoard(JSON.stringify({ ...board, edges: [{ id: 'bad', from:'a', to:'b', label:'' }] })))
})

test('labels wrap on lines and after resizing stay within the shape', () => {
  const node = { ...makeShape('note', 0, 0), label: '审批单\n待处理' }
  assert.deepEqual(shapeLines(node), ['审批单','待处理'])
  assert.match(shapeLines({ ...node, w: 36, h: 24 }).join(''), /…$/u)
})

test('templates append editable objects without covering existing notes, moving lanes carries their contents', () => {
  const original = { ...emptyBoard, nodes: [makeShape('note', 900, 100)], strokes: [] }
  const next = addTemplate(original, 'handoff')
  assert.deepEqual(original.nodes.length, 1)
  assert.equal(next.nodes[0], original.nodes[0])
  assert.ok(next.nodes[1].x > original.nodes[0].x + original.nodes[0].w)
  assert.equal(next.edges.length, 2)
  assert.deepEqual(readBoard(JSON.stringify(next)), next)
  const moved = moveObject(next, next.nodes[1].id, 42, 56)
  assert.equal(moved.nodes[3].x, next.nodes[3].x + 42)
  assert.equal(moved.nodes[4].y, next.nodes[4].y)
})

test('Mermaid export writes lane subgraphs and treats all imported identifiers and punctuation as plain labels', () => {
  const next = addTemplate(emptyBoard, 'handoff')
  const n = next.nodes.at(-1)
  n.label = '配置"]\nclick X <tag>|#'
  next.edges[0].label = '是|否'
  const code = mermaidFlow(next)
  assert.match(code, /^flowchart LR\n/u)
  assert.equal(code.split('subgraph ').length, 3)
  assert.ok(!code.includes(n.id) && !code.includes('\nclick') && !code.includes('<tag>'))
  assert.match(code, /配置#34;#93; click X #60;tag#62;#124;#35;/u)
  assert.ok(code.includes('-->|"是#124;否"|'))
})
