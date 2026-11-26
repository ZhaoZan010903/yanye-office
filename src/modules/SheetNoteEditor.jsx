import React, { useEffect, useRef } from 'react'
import { LIMITS } from './spreadsheet.js'

export default function SheetNoteEditor({address,note,save,close}) {
  const dialog=useRef(null)
  useEffect(()=>{
    const el=dialog.current
    el.showModal()
    return ()=>{if (el.open) el.close()}
  },[])
  return <dialog ref={dialog} className="sheet-note-editor" aria-label={address+' 批注'} onCancel={event=>{event.preventDefault();close()}}>
    <form onSubmit={event=>{
      event.preventDefault()
      const {author,body}=event.currentTarget.elements
      save({author:author.value.trim() || '砚页',text:body.value,...(note?.rich && note.text===body.value ? {rich:note.rich} : {})})
    }}>
      <strong>{address} 批注</strong>
      <label>作者<input name="author" maxLength={255} defaultValue={note?.author ?? '砚页'}/></label>
      <label>批注内容<textarea name="body" maxLength={LIMITS.text} required autoFocus defaultValue={note?.text || ''}/></label>
      <div><button>保存批注</button><button type="button" onClick={close}>取消</button></div>
    </form>
  </dialog>
}
