import React, { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { gotoLine, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { blankText, encodingNames, eolNames } from './plain-text.js'
import { lineEndings, textAfterEdit, txtEditorState } from './txt-history.js'
import './readers.css'

const phrases = {
  Find:'查找', Replace:'替换', 'Replace all':'全部替换', next:'下一处', previous:'上一处', all:'全选',
  replace:'替换', 'replace all':'全部替换', 'match case':'区分大小写', regexp:'正则表达式',
  'by word':'全词', close:'关闭', 'Go to line':'跳转到行', go:'跳转',
  'Replace with':'替换为', 'replaced $ matches':'已替换 $ 处', 'current match':'当前匹配',
  'Toggle replace':'显示或隐藏替换', 'Match case':'区分大小写', 'Match whole word':'匹配全词',
}

export default function PlainText({ value, onChange }) {
  const host = useRef(null), view = useRef(null), current = useRef(blankText), send = useRef(onChange)
  const extensions = useRef(null), editorText = useRef('')
  const [position, setPosition] = useState({line:1, column:1})
  current.current = typeof value?.text === 'string' ? value : blankText
  send.current = onChange

  useEffect(() => {
    extensions.current = [
        lineNumbers(), history(), search({ top:true }), EditorState.phrases.of(phrases),
        EditorView.contentAttributes.of({ 'aria-label':'纯文本正文', role:'textbox', 'aria-multiline':'true', spellcheck:'false' }),
        keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            const next = textAfterEdit(current.current, update)
            if (send.current(next) === false) {
              // The workspace refused this transaction (for example, its byte limit).
              // Restore the accepted editor state once CodeMirror finishes the update.
              queueMicrotask(() => {
                if (view.current === update.view && update.view.state === update.state) update.view.setState(update.startState)
              })
              return
            }
            editorText.current = next.text
            current.current = next
          }
          if (update.selectionSet || update.docChanged) {
            const offset = update.state.selection.main.head
            const line = update.state.doc.lineAt(offset)
            setPosition({ line:line.number, column:offset-line.from+1 })
          }
        }),
    ]
    editorText.current = current.current.text
    const editor = new EditorView({
      parent:host.current,
      state:txtEditorState(current.current, extensions.current),
    })
    view.current = editor
    return () => { editor.destroy(); view.current = null }
  }, [])

  // A clean disk binding can reload an externally changed file under the same page ID.
  useEffect(() => {
    const text = current.current.text
    const editor = view.current
    if (editor && (editorText.current !== text || editor.state.field(lineEndings) !== current.current.lineMap)) {
      editorText.current = text
      editor.setState(txtEditorState(current.current, extensions.current))
      setPosition({line:1, column:1})
    }
  }, [value])

  const model = current.current
  return <section className="txt-editor" aria-label="纯文本编辑器">
    <div className="reader-tools"><button onClick={() => openSearchPanel(view.current)}>查找与替换</button>
      <button onClick={() => gotoLine(view.current)}>跳转到行</button>
      <span>{encodingNames[model.encoding]}{model.bom ? ' · BOM' : ''} · {model.lineMap ? '混合换行' : eolNames[model.eol]}</span>
    </div>
    <div className="txt-host" ref={host}/>
    <div className="txt-position">第 {position.line} 行，第 {position.column} 列</div>
  </section>
}
