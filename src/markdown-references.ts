import { Node, type Editor, type Extensions } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { Node as DocumentNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { Marked } from 'marked'
import './markdown-references.css'

const keyFor = (label: string) => label.trim().replace(/\s+/gu,' ').toLowerCase()
const definitions = new Marked()
const labelSets = new WeakMap<Editor, Set<string>>()
export function prepareReferenceLabels(editor: Editor, labels: Iterable<string>) {
  const set = labelSets.get(editor)
  if (set) { set.clear(); for (const label of labels) set.add(keyFor(label)) }
}
const notePrefix = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*/u

// Consume indented continuation paragraphs as part of the definition. Blank
// lines belong to the footnote only when an indented continuation follows.
export function noteDefinition(source: string) {
  const prefix = notePrefix.exec(source)
  if (!prefix) return
  const rest = /^[^\n]*(?:\n(?:[ \t]*\n)*(?: {4}|\t)[^\n]*)*/u.exec(source.slice(prefix[0].length))![0]
  return {type:'noteDefinition',raw:prefix[0]+rest,label:prefix[1],prefix:prefix[0],
    body:rest.replace(/\n(?: {4}|\t)/gu,'\n')}
}

function closingBracket(source: string, start: number) {
  let depth = 1
  for (let i=start+1; i<source.length; i++) {
    if (source[i] === '\\') i++
    else if (source[i] === '[') depth++
    else if (source[i] === ']' && --depth === 0) return i
  }
  return -1
}

function referenceToken(src:string, labels:Set<string>) {
  if (!src.startsWith('[') || src.startsWith('[^')) return
  const end = closingBracket(src,0)
  if (end<1 || src[end+1]==='(') return
  const caption = src.slice(1,end), second = src[end+1]==='[' ? closingBracket(src,end+1) : -1
  const label = second>=0 ? src.slice(end+2,second) : ''
  if (second<0 && !labels.has(keyFor(caption))) return
  return {raw:src.slice(0,(second>=0?second:end)+1),label,caption,
    form:second<0?'shortcut':label?'full':'collapsed'}
}

const FootnoteReference = Node.create({
  name:'noteReference', group:'inline', inline:true, atom:true,
  addAttributes() { return { label:{ default:'' } } },
  renderHTML({node}) {
    return ['sup',{'data-note-ref':node.attrs.label, 'aria-label':'转到脚注 '+node.attrs.label,
      role:'link', tabindex:'0', contenteditable:'false'}]
  },
  markdownTokenizer: { name:'noteReference', level:'inline', start:'[^', tokenize(src) {
    const m = /^\[\^([^\]\s]+)\]/u.exec(src)
    if (m) return {type:'noteReference',raw:m[0],label:m[1]}
  }},
  parseMarkdown: (t,h) => h.createNode('noteReference',{label:t.label}),
  renderMarkdown: n => '[^'+n.attrs?.label+']',
})

const FootnoteDefinition = Node.create({
  name:'noteDefinition', group:'block', content:'block+', defining:true,
  addAttributes() { return { label:{default:''}, prefix:{default:''} } },
  renderHTML({node}) {
    const label = String(node.attrs.label)
    return ['div',{'data-note-def':label},['div',{class:'md-note-body'},0],
      ['button', {type:'button','data-note-back':label,contenteditable:'false','aria-label':'返回脚注引用 '+label}, '↩']]
  },
  renderMarkdown(node,h) {
    const body = h.renderChildren(node.content || [], '\n\n').replace(/\n(?=.)/gu,'\n    ')
    return String(node.attrs?.prefix || '[^'+node.attrs?.label+']: ') + body
  },
})

const LinkDefinition = Node.create({
  name:'linkDefinition', group:'block', content:'text*', marks:'', code:true, defining:true,
  renderHTML: () => ['div',{class:'md-link-definition',spellcheck:'false'},0],
  renderMarkdown: n => (n.content || []).map(child=>child.text || '').join(''),
})

type Note = { position?: number; refs:number[]; number?:number }
type ReferenceIndex = { decorations:DecorationSet; notes:Map<string,Note> }
const indexKey = new PluginKey<ReferenceIndex>('markdownReferences')

function index(doc: DocumentNode, labels: Set<string>): ReferenceIndex {
  const links = new Map<string,{href:string; title?:string|null}>()
  const notes = new Map<string,Note>(), refs: {node:DocumentNode;pos:number}[] = []
  let count = 0
  doc.descendants((node,pos)=>{
    if (node.type.name === 'linkDefinition') {
      const token = definitions.lexer(node.textContent)[0]
      if (token?.type === 'def' && !links.has(keyFor(token.tag))) links.set(keyFor(token.tag),{href:token.href,title:token.title})
      return false
    }
    if (node.type.name === 'referenceLink' || (node.type.name === 'image' && node.attrs.referenceForm)) refs.push({node,pos})
    if (node.type.name === 'noteReference' || node.type.name === 'noteDefinition') {
      const key = keyFor(String(node.attrs.label))
      const note = notes.get(key) ?? {refs:[]} as Note
      if (node.type.name === 'noteDefinition') note.position ??= pos
      else { note.refs.push(pos); note.number ??= ++count }
      notes.set(key,note)
    }
  })
  labels.clear()
  const dec: Decoration[] = []
  for (const label of links.keys()) labels.add(label)
  for (const {node,pos} of refs) {
    const image = node.type.name === 'image'
    const key = keyFor(image ? node.attrs.referenceLabel || node.attrs.alt :
      node.attrs.form === 'full' ? node.attrs.label : node.textContent)
    const target = links.get(key)
    const href = target?.href.trim()
    if (image) {
      if (href) dec.push(Decoration.node(pos,pos+node.nodeSize,{'data-ref-img':href},{picture:href,caption:target?.title}))
    } else if (href && !/^(?:[\\/]{2}|(?!https?:)[a-z][\w+.-]*:)/iu.test(href)) {
      dec.push(Decoration.node(pos,pos+node.nodeSize,{href, title:target?.title || href}))
    } else {
      dec.push(Decoration.node(pos,pos+node.nodeSize,{'class':'md-ref-unresolved',
        'data-ref-tail':node.attrs.form==='full'?']['+node.attrs.label+']':node.attrs.form==='collapsed'?'][]':']'}))
    }
  }
  for (const [label,note] of notes) {
    if (note.position !== undefined) dec.push(Decoration.node(note.position,note.position+doc.nodeAt(note.position)!.nodeSize,
      {'data-citation':String(note.number || label)}))
    for (const pos of note.refs) dec.push(Decoration.node(pos,pos+1,{'data-citation':note.position === undefined?'[^'+label+']':String(note.number),
      'aria-disabled':String(note.position===undefined)}))
  }
  return {decorations:DecorationSet.create(doc,dec),notes}
}

function navigation(labels: Set<string>) {
  const last = new Map<string,number>()
  function jump(view:EditorView, event:Event) {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-note-ref],[data-note-back]') : null
    if (!target) return false
    const ref = target.hasAttribute('data-note-ref')
    const label = keyFor((ref ? target.dataset.noteRef : target.dataset.noteBack) || '')
    const note = indexKey.getState(view.state)?.notes.get(label)
    if (!note || note.position === undefined || !note.refs.length) return false
    if (ref) last.set(label, Math.max(0,note.refs.findIndex(p=>view.nodeDOM(p)===target)))
    const to = ref ? note.position + 1 : (note.refs[last.get(label) ?? 0] ?? note.refs[0]) + 1
    event.preventDefault()
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(to))).scrollIntoView())
    view.focus()
    return true
  }
  return new Plugin<ReferenceIndex>({
    key:indexKey,
    state:{init:(_config,state)=>index(state.doc,labels),
      apply:(tr,prev)=>tr.docChanged?index(tr.doc,labels):prev},
    props:{decorations:state=>indexKey.getState(state)?.decorations,
      handleDOMEvents:{click:jump,keydown:(view,event)=>['Enter',' '].includes(event.key) && jump(view,event)}},
  })
}

export function markdownReferences(): Extensions {
  const labels = new Set<string>()
  const Link = Node.create({
    name:'referenceLink',group:'inline',inline:true,content:'inline*',
    onBeforeCreate(){ labelSets.set(this.editor,labels) },
    addAttributes() { return {label:{default:''},form:{default:'full'}} },
    renderHTML:({node})=>['a',{'data-reference-label':node.attrs.label},0],
    markdownTokenizer:{name:'referenceLink',level:'inline',start:src=>src.search(/!?\[/u),tokenize(src,_tokens,lexer) {
      const image = src.startsWith('![')
      const ref = referenceToken(image ? src.slice(1) : src,labels)
      if (!ref) return
      if (image) return {...ref,type:'image',raw:'!'+ref.raw,text:ref.caption,referenceForm:ref.form}
      return {...ref,type:'referenceLink',tokens:lexer.inlineTokens(ref.caption)}
    }},
    parseMarkdown:(t,h)=>h.createNode('referenceLink',{label:t.label,form:t.form},h.parseInline(t.tokens || [])),
    renderMarkdown:(n,h)=>'['+h.renderChildren(n.content || [])+']'+(n.attrs?.form==='shortcut'?'':'['+(n.attrs?.label || '')+']'),
    addProseMirrorPlugins(){return [navigation(labels)]},
  })
  return [Link, FootnoteReference, FootnoteDefinition, LinkDefinition]
}
