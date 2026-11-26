import { Fragment } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

const isParagraph = node => node?.type.name === 'paragraph' || node?.type.name === 'heading'

// OOXML tracks a paragraph's ending mark separately from the text in its runs.
// Keep the original paragraph and its formatting until review resolves the mark.
export function paragraphRange(doc, from, to) {
  // Ctrl+A can select the outer block wrappers as well as their contents.
  // The package always retains a final paragraph, including for an empty body.
  if (from === 0 && to === doc.content.size && isParagraph(doc.firstChild) && isParagraph(doc.lastChild)) {
    from++
    to--
  }
  const start = doc.resolve(from), end = doc.resolve(to)
  if (!isParagraph(start.parent) || !isParagraph(end.parent) || start.depth !== end.depth ||
      start.node(-1) !== end.node(-1) || start.start(-1) !== end.start(-1)) return null
  const paragraphs = [], parent = start.node(-1)
  if (start.index(-1) !== end.index(-1) && !['doc','tableCell','tableHeader'].includes(parent.type.name)) return null
  for (let i = start.index(-1); i <= end.index(-1); i++) {
    const node = parent.child(i)
    if (!isParagraph(node)) return null
    const content = node.content.cut(i === start.index(-1) ? start.parentOffset : 0,
      i === end.index(-1) ? end.parentOffset : node.content.size)
    if (content.content.some(child => !child.isText)) return null
    paragraphs.push({node, content})
  }
  return {paragraphs, start, end}
}

export function hasForeignInsertion(range, author) {
  return range.paragraphs.some(({node,content}, i) => {
    const foreign = revision => revision?.kind === 'ins' && revision.author !== author
    return (i + 1 < range.paragraphs.length && foreign(node.attrs.breakRevision)) ||
      content.content.some(child => child.marks.some(mark => mark.type.name === 'wordRevision' && foreign(mark.attrs)))
  })
}

// Replace steps composing one Enter/paste may delete the selection before
// inserting the split. Map their endpoints to the original and resulting docs.
export function changedRange(steps, mapping) {
  const ranges = steps.map(({step,index}) => {
    const before = mapping.slice(0,index).invert(), after = mapping.slice(index+1)
    return {from:before.map(step.from,-1), to:before.map(step.to,1),
      newFrom:after.map(step.from,-1), newTo:after.map(step.from+step.slice.size,1)}
  }).sort((a,b)=>a.from-b.from)
  const total = {...ranges[0]}
  for (const item of ranges.slice(1)) {
    if (item.from > total.to) return null
    total.to = Math.max(total.to,item.to)
    total.newFrom = Math.min(total.newFrom,item.newFrom)
    total.newTo = Math.max(total.newTo,item.newTo)
  }
  return total
}

export function trackParagraphEdit(oldState, state, range, attrs) {
  const original = paragraphRange(oldState.doc,range.from,range.to)
  const edited = paragraphRange(state.doc,range.newFrom,range.newTo)
  const type = state.schema.marks.wordRevision
  const del = {...attrs,id:attrs.id+'-del',kind:'del'}
  const ins = {...attrs,kind:'ins'}
  const blocks = []
  let template = original.start.parent
  let content = [...edited.start.parent.content.cut(0,edited.start.parentOffset).content]
  let restoredSize = 0

  function finish(revision) {
    blocks.push(template.type.create({...template.attrs,breakRevision:revision || null},Fragment.fromArray(content),template.marks))
    content = []
  }
  for (const [i,{node,content:removed}] of original.paragraphs.entries()) {
    for (const child of removed.content) {
      const previous = type.isInSet(child.marks)
      if (previous?.attrs.kind === 'ins' && previous.attrs.author === attrs.author) continue
      const retained = previous?.attrs.kind === 'del' ? child : child.mark(type.create(del).addToSet(child.marks))
      content.push(retained)
      restoredSize += retained.nodeSize
    }
    if (i + 1 < original.paragraphs.length) {
      const prior = node.attrs.breakRevision
      if (!(prior?.kind === 'ins' && prior.author === attrs.author)) {
        finish(prior?.kind === 'del' ? prior : del)
        restoredSize += 2
        template = original.paragraphs[i+1].node
      }
    }
  }
  const insertedMark = type.create(ins)
  for (const [i,part] of edited.paragraphs.entries()) {
    for (const node of part.content.content) {
      content.push(node.mark(insertedMark.addToSet(node.marks)))
    }
    if (i + 1 < edited.paragraphs.length) {
      finish(ins)
      template = edited.paragraphs[i+1].node
    }
  }
  edited.end.parent.content.cut(edited.end.parentOffset).forEach(node=>content.push(node))
  finish(original.end.parent.attrs.breakRevision)
  const tr = state.tr.replaceWith(edited.start.before(),edited.end.after(),blocks)
  const start = edited.start.pos
  const backspacing = start === edited.end.pos && oldState.selection.empty && oldState.selection.head === original.end.pos
  const restoreCursor = pos => pos < start || (backspacing && pos === start) ? pos : pos+restoredSize
  if (state.selection instanceof TextSelection) {
    tr.setSelection(TextSelection.create(tr.doc,restoreCursor(state.selection.anchor),restoreCursor(state.selection.head)))
  }
  return tr
}
