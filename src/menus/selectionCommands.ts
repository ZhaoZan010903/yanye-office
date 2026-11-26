import type { Editor } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { EditorView as SourceView } from '@codemirror/view'
import { undo, redo } from '@codemirror/commands'

export type Choice = { label: string, action?: () => unknown, keys?: string, items?: Choice[], disabled?: boolean }

export const copy = (value: string) => navigator.clipboard.writeText(value)

export function selectionCommands(e: Editor, source: boolean, target: Element, textInput: HTMLTextAreaElement | null) {
  const cm = source && target.closest('.cm-editor') ? SourceView.findFromDOM(target as HTMLElement) : null
  const sel = e.state.selection
  function selectedText() {
    if (source) {
      if (textInput) return textInput.value.slice(textInput.selectionStart,textInput.selectionEnd)
      if (cm) return cm.state.sliceDoc(cm.state.selection.main.from,cm.state.selection.main.to)
      return ''
    }
    return e.state.doc.textBetween(sel.from,sel.to,'\n')
  }
  function markdownSelection() {
    const slice = sel.content()
    return e.markdown?.serialize({type:'doc',content:slice.content.toJSON()}) || selectedText()
  }
  function htmlSelection() {
    const fragment = DOMSerializer.fromSchema(e.schema).serializeFragment(sel.content().content)
    const wrap = document.createElement('div')
    wrap.append(fragment)
    return wrap.innerHTML
  }
  function pasteText(text: string) {
    if (textInput && source) {
      textInput.focus()
      document.execCommand(text ? 'insertText' : 'delete',false,text)
    } else if (cm && source) {
      cm.focus(); cm.dispatch(cm.state.replaceSelection(text))
    } else {
      e.view.focus()
      if (text) e.view.pasteText(text)
      else e.commands.deleteSelection()
    }
  }
  const hasSelection = source ? Boolean(textInput ? textInput.selectionStart !== textInput.selectionEnd : cm && !cm.state.selection.main.empty) : !sel.empty
  async function copySelection() {
    if (source || typeof ClipboardItem === 'undefined') return copy(selectedText())
    const html = htmlSelection(), plain = selectedText()
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain':new Blob([plain],{type:'text/plain'}),
      'text/html':new Blob([html],{type:'text/html'}),
    })])
  }
  async function cutSelection() {
    const originalState = cm?.state ?? e.state
    const start = textInput?.selectionStart
    const end = textInput?.selectionEnd
    const value = textInput?.value
    await copySelection()
    if (source && textInput) {
      if (start !== textInput.selectionStart || end !== textInput.selectionEnd || value !== textInput.value) return
    } else if ((cm?.state ?? e.state) !== originalState) return
    pasteText('')
  }
  async function pasteClipboard() {
    if (!source && navigator.clipboard.read) {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        if (item.types.includes('text/html')) {
          const html = await (await item.getType('text/html')).text()
          e.view.focus()
          e.view.pasteHTML(html)
          return
        }
        if (item.types.includes('text/plain')) {
          pasteText(await (await item.getType('text/plain')).text())
          return
        }
      }
      return
    }
    pasteText(await navigator.clipboard.readText())
  }
  const clipboard: Choice[] = [
    {label:'剪切', keys:'Ctrl+X', disabled:!hasSelection, action:cutSelection},
    {label:'复制', keys:'Ctrl+C', disabled:!hasSelection, action:copySelection},
    {label:'粘贴', keys:'Ctrl+V', action:pasteClipboard},
  ]
  const choices: Choice[] = [
    {label:'撤销', keys:'Ctrl+Z', disabled:!source && !e.can().undo(), action:()=>source ? cm ? undo(cm) : document.execCommand('undo') : e.commands.undo()},
    {label:'重做', keys:'Ctrl+Y', disabled:!source && !e.can().redo(), action:()=>source ? cm ? redo(cm) : document.execCommand('redo') : e.commands.redo()},
    ...clipboard,
  ]
  if (!source) choices.push({label:'复制／粘贴为', items:[
      {label:'复制为 Markdown',disabled:!hasSelection,action:()=>copy(markdownSelection())},
      {label:'复制为 HTML 代码',disabled:!hasSelection,action:()=>copy(htmlSelection())},
      {label:'复制为纯文本',disabled:!hasSelection,action:()=>copy(selectedText())},
      {label:'粘贴为纯文本',action:async()=>pasteText(await navigator.clipboard.readText())},
    ]})
  const selectAll: Choice = {label:'全选',keys:'Ctrl+A',action:()=>source ? cm ? cm.dispatch({selection:{anchor:0,head:cm.state.doc.length}}) : textInput?.select() : e.commands.selectAll()}
  return {choices,selectAll}
}
