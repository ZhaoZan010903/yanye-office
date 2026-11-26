import { Mark, Node } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Fragment } from '@tiptap/pm/model'
import { Mapping, ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform'
import { isHistoryTransaction } from '@tiptap/pm/history'

export const revisionAction = new PluginKey('word-revision-action')
export const SectionBreak = Node.create({
  name: 'sectionBreak', group: 'block', atom: true, selectable: true,
  addAttributes() { return { layout: { default: {}, rendered: false } } },
  renderHTML() { return ['div', { class: 'word-section-break', 'data-word-section': '', contenteditable: 'false' }, '分节符'] },
})

export function currentSection(doc, cursor) {
  let index=1, end=null
  doc.forEach((node, pos) => {
    if (node.type.name !== 'sectionBreak') return
    if (pos < cursor) index++
    else if (!end) end={pos,layout:node.attrs.layout}
  })
  return { index, end }
}

function bypassTracking(tr) {
  return tr.getMeta(revisionAction) || tr.getMeta('preventUpdate') || isHistoryTransaction(tr)
}

// A text revision can describe a change only within one block. Reject the
// whole transaction before applying it if any step would discard structure.
function textReplacedBy(step, doc) {
  if (!(step instanceof ReplaceStep) || step.slice.openStart || step.slice.openEnd) return null
  const from=doc.resolve(step.from), to=doc.resolve(step.to)
  if (!from.sameParent(to) || !from.parent.isTextblock) return null
  const removed=doc.slice(step.from,step.to).content
  return [...removed.content,...step.slice.content.content].every(node=>node.isText) ? removed : null
}

export const WordRevision = Mark.create({
  name: 'wordRevision', inclusive: false,
  addAttributes() { return { id: {default:''}, kind:{default:'ins'}, author:{default:''}, date:{default:''} } },
  renderHTML({mark}) {
    return [mark.attrs.kind==='del'?'del':'ins', {class:'word-revision',title:mark.attrs.author}, 0]
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      filterTransaction: tr => {
        if (!tr.docChanged || bypassTracking(tr)) return true
        const settings=this.options.settings()
        if (!settings.enabled) return true
        for (const [index,step] of tr.steps.entries()) {
          const replacesText=step instanceof ReplaceStep
          const removed=replacesText ? textReplacedBy(step,tr.docs[index]) : null
          if ((replacesText && !removed) || step instanceof ReplaceAroundStep) {
            this.options.report?.('跟踪修订时可在同一段落内编辑文字。跨段编辑或更改文档结构前，请先关闭跟踪修订。')
            return false
          }
          const touchesOtherInsertion=removed?.content.some(node=>node.marks.some(mark=>
            mark.type.name==='wordRevision' && mark.attrs.kind==='ins' && mark.attrs.author!==settings.author))
          if (touchesOtherInsertion || step.mark?.type.name==='wordRevision') {
            this.options.report?.('请先接受或拒绝所选文字的已有修订，再修改该处。')
            return false
          }
        }
        return true
      },
      appendTransaction: (transactions, oldState, state) => {
        const settings=this.options.settings()
        if (!settings.enabled || !transactions.some(tr=>tr.docChanged) ||
            transactions.some(bypassTracking)) return null
        const records=[]
        const mapping=new Mapping()
        for (const tr of transactions) {
          for (const [index, step] of tr.steps.entries()) {
            mapping.appendMap(step.getMap())
            const removed=textReplacedBy(step,tr.docs[index])
            if (!removed) continue
            records.push({removed, from:step.from, to:step.from+step.slice.size, mapIndex:mapping.maps.length})
          }
        }
        const result=state.tr, type=state.schema.marks.wordRevision
        const attrs={id:crypto.randomUUID(),author:settings.author,date:new Date().toISOString()}
        for (const edit of records) {
          const rest=mapping.slice(edit.mapIndex)
          const start=result.mapping.map(rest.map(edit.from,1),1)
          const end=result.mapping.map(rest.map(edit.to,-1),-1)
          if (end>start) result.addMark(start,end,type.create({...attrs,kind:'ins'}))
          const deleted=[]
          edit.removed.forEach(node=>{
            const previous=type.isInSet(node.marks)
            if (previous?.attrs.kind==='ins' && previous.attrs.author===attrs.author) return
            deleted.push(previous?.attrs.kind==='del' ? node :
              node.mark(type.create({...attrs,id:attrs.id+'-del',kind:'del'}).addToSet(node.marks)))
          })
          if (deleted.length) result.insert(start,Fragment.fromArray(deleted))
        }
        return result.docChanged ? result.setMeta(revisionAction,true) : null
      },
    })]
  },
})

export function revisions(doc) {
  const byId=new Map()
  doc.descendants((node,pos)=>{
    const mark=node.marks.find(m=>m.type.name==='wordRevision')
    if (!mark || !node.isText) return
    if (!byId.has(mark.attrs.id)) byId.set(mark.attrs.id,{...mark.attrs,text:'',spans:[]})
    const item=byId.get(mark.attrs.id)
    item.text+=node.text
    item.spans.push({from:pos,to:pos+node.nodeSize,mark})
  })
  return [...byId.values()]
}

export function resolveRevisions(editor, items, accept) {
  const tr=editor.state.tr
  const spans=items.flatMap(item=>item.spans).sort((a,b)=>b.from-a.from)
  for (const {from,to,mark} of spans) {
    if ((mark.attrs.kind==='del')===accept) tr.delete(from,to)
    else tr.removeMark(from,to,mark)
  }
  if (tr.docChanged) editor.view.dispatch(tr.setMeta(revisionAction,true))
}
