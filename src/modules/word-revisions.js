import { Mark, Node } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Fragment } from '@tiptap/pm/model'
import { canJoin, Mapping, ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform'
import { isHistoryTransaction } from '@tiptap/pm/history'
import { changedRange, hasForeignInsertion, paragraphRange, trackParagraphEdit } from './word-paragraph-revisions.js'

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

function textReplacedBy(step, doc) {
  if (!(step instanceof ReplaceStep) || step.slice.openStart || step.slice.openEnd) return null
  const from=doc.resolve(step.from), to=doc.resolve(step.to)
  if (!from.sameParent(to) || !from.parent.isTextblock) return null
  const removed=doc.slice(step.from,step.to).content
  return [...removed.content,...step.slice.content.content].every(node=>node.isText) ? removed : null
}

export const WordRevision = Mark.create({
  name: 'wordRevision', inclusive: false,
  addGlobalAttributes() {
    return [{types:['paragraph','heading'],attributes:{
      breakRevision:{default:null,keepOnSplit:false,parseHTML:()=>null,renderHTML:attrs=>
        ['ins','del'].includes(attrs.breakRevision?.kind) ? {'data-break-revision':attrs.breakRevision.kind} : {}},
      paragraphFormatRevision:{default:null,rendered:false,keepOnSplit:false},
    }}]
  },
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
        const replacements=[]
        let structural=false
        for (const [index,step] of tr.steps.entries()) {
          const replacesText=step instanceof ReplaceStep
          const removed=replacesText ? textReplacedBy(step,tr.docs[index]) : null
          if (replacesText) replacements.push({step,index})
          if ((replacesText && !removed) || step instanceof ReplaceAroundStep) {
            const before=replacesText && paragraphRange(tr.docs[index],step.from,step.to)
            const after=before && paragraphRange(tr.docs[index+1] || tr.doc,step.from,step.from+step.slice.size)
            if (!before || !after || hasForeignInsertion(before,settings.author) ||
                before.paragraphs.some(p=>p.node.attrs.paragraphFormatRevision)) {
              this.options.report?.('跟踪修订支持正文段落间的跨段编辑。请先处理已有修订，或关闭跟踪后再更改对象和分节。')
              return false
            }
            structural=true
          }
          const touchesOtherInsertion=removed?.content.some(node=>node.marks.some(mark=>
            mark.type.name==='wordRevision' && mark.attrs.kind==='ins' && mark.attrs.author!==settings.author))
          if (touchesOtherInsertion || step.mark?.type.name==='wordRevision') {
            this.options.report?.('请先接受或拒绝所选文字的已有修订，再修改该处。')
            return false
          }
        }
        if (structural) {
          const range=changedRange(replacements,tr.mapping)
          if (!range || !paragraphRange(tr.before,range.from,range.to) || !paragraphRange(tr.doc,range.newFrom,range.newTo)) {
            this.options.report?.('请分次提交不同区域的跨段编辑。')
            return false
          }
        }
        return true
      },
      appendTransaction: (transactions, oldState, state) => {
        const settings=this.options.settings()
        if (!settings.enabled || !transactions.some(tr=>tr.docChanged) ||
            transactions.some(bypassTracking)) return null
        const records=[], replacements=[]
        let structural=false
        const mapping=new Mapping()
        for (const tr of transactions) {
          for (const [index, step] of tr.steps.entries()) {
            mapping.appendMap(step.getMap())
            if (step instanceof ReplaceStep) replacements.push({step,index:mapping.maps.length-1})
            const removed=textReplacedBy(step,tr.docs[index])
            if (!removed) { if (step instanceof ReplaceStep) structural=true; continue }
            records.push({removed, from:step.from, to:step.from+step.slice.size, oldTo:step.to, mapIndex:mapping.maps.length})
          }
        }
        const result=state.tr, type=state.schema.marks.wordRevision
        const attrs={id:crypto.randomUUID(),author:settings.author,date:new Date().toISOString()}
        if (structural) {
          const range=changedRange(replacements,mapping)
          if (range) return trackParagraphEdit(oldState,state,range,attrs).setMeta(revisionAction,true)
        }
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
          if (deleted.length) {
            result.insert(start,Fragment.fromArray(deleted))
            // Consecutive Backspaces continue left of the struck-out text.
            // Forward Delete keeps the mapped caret on its right.
            if (records.length===1 && edit.from===edit.to && oldState.selection.empty && oldState.selection.head===edit.oldTo) {
              result.setSelection(TextSelection.create(result.doc,start))
            }
          }
        }
        return result.docChanged ? result.setMeta(revisionAction,true) : null
      },
    })]
  },
})

export function revisions(doc) {
  const segments=[]
  function add(attrs,text,span) {segments.push({attrs,text,span})}
  doc.descendants((node,pos)=>{
    if (node.attrs.paragraphFormatRevision) {
      add(node.attrs.paragraphFormatRevision,'段落格式',{from:pos+1,format:true})
    }
    if (node.attrs.breakRevision) {
      const from=pos+node.nodeSize-1
      add(node.attrs.breakRevision,'¶',{from,to:from+2,boundary:true})
    }
    const mark=node.marks.find(m=>m.type.name==='wordRevision')
    if (!mark || !node.isText) return
    add(mark.attrs,node.text,{from:pos,to:pos+node.nodeSize,mark})
  })
  // Word assigns separate numeric IDs to adjacent run and ending revisions.
  // Its review pane treats the uninterrupted change as one user action.
  segments.sort((a,b)=>a.span.from-b.span.from)
  const byId=new Map(), list=[]
  let previous
  for (const {attrs,text,span} of segments) {
    let item=byId.get(attrs.id)
    if (!item && previous?.spans.at(-1)?.to===span.from && previous.kind===attrs.kind &&
        previous.author===attrs.author && previous.date===attrs.date) item=previous
    if (!item) {
      item={...attrs,text:'',spans:[]}
      list.push(item)
    }
    byId.set(attrs.id,item)
    item.text+=text
    item.spans.push(span)
    previous=item
  }
  return list
}

export function reviewTransaction(state, items, accept) {
  const tr=state.tr
  const spans=items.flatMap(item=>item.spans.map(span=>({...span,revision:item}))).sort((a,b)=>b.from-a.from || Number(b.format)-Number(a.format))
  for (const {from,to,mark,boundary,format,revision} of spans) {
    if (format) {
      const $pos=tr.doc.resolve(from), node=$pos.parent
      const prior=revision.previous
      if (!accept && prior) tr.setNodeMarkup($pos.before(),state.schema.nodes[prior.type],{
        ...prior.attrs,breakRevision:node.attrs.breakRevision,paragraphFormatRevision:null})
      else tr.setNodeAttribute($pos.before(),'paragraphFormatRevision',null)
    } else if (boundary) {
      const $pos=tr.doc.resolve(from)
      if ((revision.kind==='del')===accept) {
        if (!canJoin(tr.doc,from+1)) continue
        const next=tr.doc.resolve(from+1).nodeAfter
        tr.setNodeAttribute($pos.before(),'breakRevision',next.attrs.breakRevision)
        tr.join(from+1)
      } else tr.setNodeAttribute($pos.before(),'breakRevision',null)
    } else if ((mark.attrs.kind==='del')===accept) tr.delete(from,to)
    else tr.removeMark(from,to,mark)
  }
  return tr.setMeta(revisionAction,true)
}

export function resolveRevisions(editor, items, accept) {
  const tr=reviewTransaction(editor.state,items,accept)
  if (tr.docChanged) editor.view.dispatch(tr)
}
