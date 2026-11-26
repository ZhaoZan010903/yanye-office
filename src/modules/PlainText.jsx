import React, { useEffect, useRef, useState } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, highlightWhitespace, keymap, lineNumbers } from '@codemirror/view'
import { copyLineDown, defaultKeymap, deleteLine, history, historyKeymap, moveLineDown, moveLineUp, redo, undo } from '@codemirror/commands'
import { gotoLine, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { blankText, encodingNames, eolNames } from './plain-text.js'
import { convertFileFormat, fileFormat, lineEndings, setFileFormat, textAfterEdit, txtEditorState } from './txt-history.js'
import { bookmarks, bookmarkGutter, editLines, jumpBookmark, restoreBookmarks, toggleBookmark } from './txt-commands.js'
import './readers.css'
import './writing-tools.css'

const phrases = {
  Find:'查找', Replace:'替换', 'Replace all':'全部替换', next:'下一处', previous:'上一处', all:'全选',
  replace:'替换', 'replace all':'全部替换', 'match case':'区分大小写', regexp:'正则表达式',
  'by word':'全词', close:'关闭', 'Go to line':'跳转到行', go:'跳转',
  'Replace with':'替换为', 'replaced $ matches':'已替换 $ 处', 'current match':'当前匹配',
  'Toggle replace':'显示或隐藏替换', 'Match case':'区分大小写', 'Match whole word':'匹配全词',
}

const wrapping = new Compartment(), whitespace = new Compartment()
const formats = { utf8:{encoding:'utf-8',bom:false}, utf8bom:{encoding:'utf-8',bom:true},
  utf16le:{encoding:'utf-16le',bom:true}, utf16be:{encoding:'utf-16be',bom:true},
  gb18030:{encoding:'gb18030',bom:false}, gbk:{encoding:'gbk',bom:false} }

export default function PlainText({ value, disk, onChange }) {
  const host = useRef(null), view = useRef(null), current = useRef(blankText), send = useRef(onChange)
  const extensions = useRef(null), editorText = useRef('')
  const [position, setPosition] = useState({line:1, column:1})
  const [markCount, setMarkCount] = useState(0)
  const [wrap, setWrap] = useState(false), [spaces, setSpaces] = useState(false)
  const latestDisk = useRef(disk)
  latestDisk.current = disk
  current.current = typeof value?.text === 'string' ? value : blankText
  send.current = onChange

  useEffect(() => {
    extensions.current = [
        bookmarks, bookmarkGutter, lineNumbers(), history(), search({ top:true }), EditorState.phrases.of(phrases),
        wrapping.of([]), whitespace.of([]),
        EditorView.contentAttributes.of({ 'aria-label':'纯文本正文', role:'textbox', 'aria-multiline':'true', spellcheck:'false' }),
        keymap.of([
          { key:'Mod-F2', run:toggleBookmark }, { key:'F2', run:v=>jumpBookmark(v,1) },
          { key:'Shift-F2', run:v=>jumpBookmark(v,-1) }, {key:'Mod-d', run:copyLineDown},
          { key:'Mod-g', run:gotoLine }, { key:'Mod-Shift-l', run:deleteLine },
          { key:'Mod-h', run:v=>{openSearchPanel(v); v.dom.querySelector('.cm-panel input[name=replace]')?.focus(); return true} },
          { key:'Mod-Shift-ArrowUp', run:moveLineUp }, { key:'Mod-Shift-ArrowDown', run:moveLineDown },
          ...searchKeymap, ...historyKeymap, ...defaultKeymap,
        ]),
        EditorView.updateListener.of(update => {
          if (update.startState.field(bookmarks) !== update.state.field(bookmarks)) setMarkCount(update.state.field(bookmarks).size)
          if (update.docChanged || update.transactions.some(tr => tr.effects.some(effect=>effect.is(setFileFormat)))) {
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
    const key = disk?.id && 'txt-bookmarks:' + disk.id
    if (key) {
      try {
        const saved = JSON.parse(localStorage.getItem(key))
        if (saved?.revision === disk.revision && Array.isArray(saved.lines)) restoreBookmarks(editor, saved.lines)
      } catch { /* A missing preference does not affect the open document. */ }
    }
    const remember = () => {
      const currentDisk=latestDisk.current
      if (!currentDisk?.id) return
      const currentKey='txt-bookmarks:'+currentDisk.id
      const lines = [...editor.state.field(bookmarks)].map(pos => editor.state.doc.lineAt(pos).number)
      try {
        if (lines.length) localStorage.setItem(currentKey, JSON.stringify({ revision:currentDisk.revision, lines }))
        else localStorage.removeItem(currentKey)
      } catch { /* Bookmarks are local view preferences. */ }
    }
    window.addEventListener('pagehide', remember)
    return () => { remember(); window.removeEventListener('pagehide', remember); editor.destroy(); view.current = null }
  }, [])

  // A clean disk binding can reload an externally changed file under the same page ID.
  useEffect(() => {
    const text = current.current.text
    const editor = view.current
    const format = editor?.state.field(fileFormat)
    if (editor && (editorText.current !== text || editor.state.field(lineEndings) !== current.current.lineMap ||
        format.encoding !== current.current.encoding || format.bom !== current.current.bom || format.eol !== current.current.eol)) {
      editorText.current = text
      editor.setState(txtEditorState(current.current, extensions.current))
      editor.dispatch({effects:[wrapping.reconfigure(wrap ? EditorView.lineWrapping : []), whitespace.reconfigure(spaces ? highlightWhitespace() : [])]})
      setPosition({line:1, column:1})
      setMarkCount(0)
    }
  }, [value, wrap, spaces])

  const model = current.current
  function run(command) { const editor=view.current; if (editor) { command(editor); editor.focus() } }
  function show(compartment, extension, active, setter) {
    run(v => v.dispatch({effects:compartment.reconfigure(active ? [] : extension)}))
    setter(!active)
  }
  const lineCommands = { copy:copyLineDown, up:moveLineUp, down:moveLineDown, delete:deleteLine }
  const formatKey = Object.keys(formats).find(key => formats[key].encoding === model.encoding && formats[key].bom === model.bom)
  return <section className="txt-editor" aria-label="纯文本编辑器">
    <div className="reader-tools txt-tools"><button onClick={() => run(undo)}>撤销</button><button onClick={() => run(redo)}>重做</button>
      <button onClick={() => openSearchPanel(view.current)}>查找与替换</button>
      <button onClick={() => gotoLine(view.current)}>跳转到行</button>
      <select aria-label="行操作" value="" onChange={e=>{ const action=e.target.value; run(lineCommands[action] ?? (v=>editLines(v,action))) }}>
        <option value="" disabled>行操作</option>
        {Object.entries({copy:'复制当前行',up:'上移行',down:'下移行',delete:'删除行',sort:'升序排列',reverseSort:'降序排列',unique:'去重行',
          trim:'删除行末空白',upper:'选区转大写',lower:'选区转小写'}).map(([key,label])=><option key={key} value={key}>{label}</option>)}
      </select>
      <button onClick={()=>run(toggleBookmark)} title="切换本行书签（Ctrl F2）">书签{markCount ? ' · '+markCount : ''}</button>
      <button disabled={!markCount} onClick={()=>run(v=>jumpBookmark(v,-1))} title="Shift F2">上一书签</button>
      <button disabled={!markCount} onClick={()=>run(v=>jumpBookmark(v,1))} title="F2">下一书签</button>
      <button aria-pressed={wrap} onClick={()=>show(wrapping,EditorView.lineWrapping,wrap,setWrap)}>自动换行</button>
      <button aria-pressed={spaces} onClick={()=>show(whitespace,highlightWhitespace(),spaces,setSpaces)}>显示空白</button>
    </div>
    <div className="txt-host" ref={host}/>
    <div className="txt-position txt-format">
      <span>第 {position.line} 行，第 {position.column} 列</span>
      <select aria-label="保存编码" value={formatKey ?? 'source'}
        onChange={e=>run(v=>convertFileFormat(v,formats[e.target.value]))}>
        {!formatKey && <option value="source">{encodingNames[model.encoding]}{model.bom ? ' · BOM' : ''}</option>}
        {Object.entries(formats).map(([id,fmt])=><option key={id} value={id}>{encodingNames[fmt.encoding]}{fmt.bom?' · BOM':''}</option>)}
      </select>
      <select aria-label="行尾格式" value={model.lineMap ? 'mixed' : model.eol} onChange={e=>run(v=>convertFileFormat(v,{eol:e.target.value}))}>
        {model.lineMap && <option value="mixed">混合换行</option>}
        {Object.entries(eolNames).map(([id,label])=><option value={id} key={id}>{label}</option>)}
      </select>
    </div>
  </section>
}
