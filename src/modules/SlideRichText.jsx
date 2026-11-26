import React,{useLayoutEffect,useRef} from 'react'
import {Schema,Slice} from '@tiptap/pm/model'
import {EditorState,TextSelection} from '@tiptap/pm/state'
import {EditorView} from '@tiptap/pm/view'
import {baseKeymap} from '@tiptap/pm/commands'
import {keymap} from '@tiptap/pm/keymap'
import {history,undo,redo} from '@tiptap/pm/history'
import {addRun,pieces,runCss} from './slide-runs.js'

const schema=new Schema({nodes:{
  doc:{content:'paragraph+'},paragraph:{group:'block',content:'text*',parseDOM:[{tag:'p'}],toDOM:()=>['p',0]},
  text:{group:'inline'}
},marks:{format:{attrs:{style:{}},toDOM:mark=>{
  const element=document.createElement('span')
  Object.assign(element.style,runCss(mark.attrs.style))
  return {dom:element,contentDOM:element}
}}}})

function toDoc(text,runs) {
  let offset=0
  return schema.node('doc',null,text.split('\n').map(line=>{
    const nodes=pieces(line,runs,offset).map(piece=>schema.text(piece.text,
      Object.keys(piece.style).length ? [schema.mark('format',{style:piece.style})] : []))
    offset+=line.length+1
    return schema.node('paragraph',null,nodes)
  }))
}
function fromDoc(doc) {
  const lines=[],runs=[]
  let offset=0
  doc.forEach(p=>{
    lines.push(p.textContent)
    p.forEach(n=>{
      if(n.marks.length)addRun(runs,offset,offset+n.nodeSize,n.marks[0].attrs.style)
      offset+=n.nodeSize
    })
    offset++
  })
  return {text:lines.join('\n'),runs}
}
function offsetAt(doc,pos) {return doc.textBetween(0,pos,'\n').length}
function positionAt(doc,offset) {
  let start=0, result=doc.content.size-1
  doc.forEach((p,pos)=>{
    if(offset>=start && offset<=start+p.content.size)result=pos+1+offset-start
    start+=p.content.size+1
  })
  return result
}
const plugins=[history(),keymap({'Mod-z':undo,'Mod-y':redo,'Mod-Shift-z':redo}),keymap(baseKeymap)]

export default function SlideRichText({text='',runs,style,className,label,placeholder,onActivate,onSelection,onEdit}) {
  const host=useRef(null),view=useRef(null),live=useRef(null),rendered=useRef(null)
  live.current={text,runs,onActivate,onSelection,onEdit}
  useLayoutEffect(()=>{
    function report(state) {
      const {from,to}=state.selection
      live.current.onSelection?.({from:offsetAt(state.doc,from),to:offsetAt(state.doc,to)})
    }
    // WebView's selectionchange can arrive after the ribbon takes focus. On
    // input release, read the live DOM endpoints before focus leaves the box.
    function reportDOM(editor) {
      const range=editor.dom.ownerDocument.getSelection()
      if(!range?.anchorNode || !range.focusNode || !editor.dom.contains(range.anchorNode) || !editor.dom.contains(range.focusNode))return false
      const a=editor.posAtDOM(range.anchorNode,range.anchorOffset)
      const b=editor.posAtDOM(range.focusNode,range.focusOffset)
      live.current.onSelection?.({from:offsetAt(editor.state.doc,Math.min(a,b)),to:offsetAt(editor.state.doc,Math.max(a,b))})
      return false
    }
    const initial=live.current
    const editor=new EditorView(host.current,{
      state:EditorState.create({doc:toDoc(initial.text,initial.runs),plugins}),
      attributes:{role:'textbox','aria-label':label,'aria-multiline':'true','data-placeholder':placeholder || '',spellcheck:'false'},
      handlePaste(view,event){
        const text=event.clipboardData?.getData('text/plain')
        if(text==null)return false
        const slice=Slice.maxOpen(toDoc(text.replace(/\r\n?/g,'\n'),[]).content)
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
        return true
      },
      handleDOMEvents:{focus(){live.current.onActivate?.();report(editor.state);return false},
        keyup:reportDOM,pointerup:reportDOM,blur:reportDOM},
      dispatchTransaction(tr) {
        const state=editor.state.apply(tr)
        editor.updateState(state)
        if(tr.docChanged){
          const data=fromDoc(state.doc)
          rendered.current=data
          live.current.onEdit(data)
        }
        if(editor.hasFocus())report(state)
      }
    })
    rendered.current={text:initial.text,runs:initial.runs}
    view.current=editor
    return ()=>{editor.destroy();view.current=null}
  },[label,placeholder])
  useLayoutEffect(()=>{
    const editor=view.current, old=rendered.current
    if(!editor || old?.text===text && old?.runs===runs)return
    const doc=toDoc(text,runs)
    rendered.current={text,runs}
    if(editor.state.doc.eq(doc))return
    const {anchor,head}=editor.state.selection
    const a=offsetAt(editor.state.doc,anchor),b=offsetAt(editor.state.doc,head)
    const tr=editor.state.tr.replaceWith(0,editor.state.doc.content.size,doc.content)
    tr.setSelection(TextSelection.create(tr.doc,positionAt(tr.doc,a),positionAt(tr.doc,b)))
    editor.updateState(editor.state.apply(tr))
  },[text,runs])
  return <div className={className+' slides-rich-editor'} style={style} ref={host}/>
}
