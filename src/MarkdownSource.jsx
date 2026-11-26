import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { EditorSelection } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { textModel, restoreLineEndings } from './modules/plain-text.js'
import { txtEditorState, textAfterEdit } from './modules/txt-history.js'
import { MAX_MARKDOWN_LENGTH } from '../shared/workspace.mjs'
import { markdownSourceLanguage } from './markdown-source-language'
import './markdown-source.css'

const MarkdownSource=forwardRef(function MarkdownSource({ markdown, onChange, visible, onCursor, focusOnShow }, ref) {
  const mount=useRef(null), view=useRef(null), accepted=useRef(markdown), send=useRef(onChange)
  const extensions=useRef(null), model=useRef(null)
  send.current=onChange
  function createState(text) {
    model.current=textModel(text,'utf-8',false)
    if(!text.includes('\r')) model.current.eol='n'
    return txtEditorState(model.current,extensions.current)
  }
  function range(from,to,direction) {
    const v=view.current, end=v.state.doc.length
    const a=Math.min(from,end), b=Math.min(to,end)
    return direction==='backward' ? EditorSelection.single(b,a) : EditorSelection.single(a,b)
  }
  useImperativeHandle(ref,()=>({
    focus(){view.current?.focus()},
    selectedSource() {
      const s=view.current.state.selection.main
      return {start:s.from,end:s.to,direction:s.head<s.anchor?'backward':'forward',scroll:view.current.scrollDOM.scrollTop}
    },
    selectSource(from,to,direction,scroll) {
      const v=view.current
      v.focus()
      const selection=range(from,to,direction)
      v.dispatch({selection,effects:scroll==null?EditorView.scrollIntoView(selection.main,{y:'center'}):[]})
      if(scroll!=null) v.scrollDOM.scrollTop=scroll
    },
    replaceRanges(matches,insert) {
      const v=view.current
      v.focus()
      v.dispatch({changes:matches.map(({from,to})=>({from,to,insert})),userEvent:'input.replace'})
    },
  }),[])
  useLayoutEffect(()=>{
    const landmarks = lineNumbers({
      formatNumber(number, state) {
        return number === 1 || number % 10 === 0 || number === state.doc.lines ? String(number) : ''
      },
    })
    extensions.current=[markdownSourceLanguage,landmarks,highlightActiveLine(),highlightActiveLineGutter(),history(),EditorView.lineWrapping,
      placeholder('开始编写 Markdown…'),keymap.of([...historyKeymap,...defaultKeymap]),
      EditorView.contentAttributes.of({'aria-label':'Markdown 源码',role:'textbox','aria-multiline':'true',spellcheck:'false'}),
      EditorView.updateListener.of(update=>{
        if (update.docChanged || update.selectionSet) {
          const head = update.state.selection.main.head
          const line = update.state.doc.lineAt(head)
          onCursor({line:line.number, column:head-line.from+1})
        }
        if(!update.docChanged) return
        const nextModel=textAfterEdit(model.current,update)
        const next=nextModel.eol==='n' && nextModel.lineMap===undefined ? nextModel.text : restoreLineEndings(nextModel)
        if(next.length<=MAX_MARKDOWN_LENGTH && send.current({markdown:next})!==false) {
          accepted.current=next;model.current=nextModel
        }
        else queueMicrotask(()=>{if(view.current?.state===update.state) view.current.setState(update.startState)})
      })]
    view.current=new EditorView({parent:mount.current,state:createState(accepted.current)})
    return ()=>{view.current.destroy();view.current=null}
  },[])
  useLayoutEffect(()=>{
    if(visible && markdown!==accepted.current) {
      const v=view.current
      // External reloads and edits made in rich mode establish a new undo base.
      accepted.current=markdown
      v.setState(createState(markdown))
      onCursor({line:1,column:1})
    }
    if(visible) view.current.requestMeasure()
  },[markdown,visible])
  useLayoutEffect(()=>{
    if(visible && focusOnShow) view.current?.focus()
  },[visible,focusOnShow])
  return <div ref={mount} className="md-source-surface"/>
})

export default MarkdownSource
