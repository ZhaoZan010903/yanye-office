import React,{useState} from 'react'
import {Node} from '@tiptap/core'
import {useEditorState} from '@tiptap/react'
import {ListTree,RefreshCw,Footprints,CornerDownRight,ChevronUp,ChevronDown} from 'lucide-react'
import {RibbonGroup} from '../office/Ribbon'
import {noteKinds,tocLevels} from './word-references.js'

export const WordNote=Node.create({
  name:'wordNote',inline:true,group:'inline',atom:true,
  addAttributes(){return {kind:{default:'footnote'},text:{default:''},native:{default:null}}},
  parseHTML(){return [{tag:'sup[data-note-kind]',getAttrs:el=>({kind:el.dataset.noteKind==='endnote'?'endnote':'footnote',text:el.getAttribute('title') || ''})}]},
  renderHTML({node}) {
    const {kind,text}=node.attrs
    return ['sup',{'data-note-kind':kind,class:'word-reference',title:text,'aria-label':noteKinds[kind]+' '+text}]
  },
})
export const WordToc=Node.create({
  name:'wordToc',group:'block',atom:true,
  addAttributes(){return {levels:{default:3},entries:{default:[]},before:{default:[]},after:{default:[]}}},
  renderHTML({node}){
    const entries=node.attrs.entries
    return ['nav',{'data-word-toc':'','aria-label':'目录',class:'word-toc'},
      ...(entries.length?entries.map(({level,text})=>['div',{style:'padding-inline-start:'+((tocLevels(level)-1)*16)+'px'},text]):[['div',{},'目录暂无标题']])]
  },
})

export function documentOutline(doc) {
  const headings=[],notes=[],tocs=[],counts={footnote:0,endnote:0}
  doc.descendants((node,pos)=>{
    if(node.type.name==='heading') headings.push({pos,level:node.attrs.level,text:node.textContent})
    if(node.type.name==='wordToc') tocs.push({pos,node})
    if(node.type.name==='wordNote') notes.push({pos,node,number:++counts[node.attrs.kind]})
  })
  return {headings,notes,tocs}
}
export function WordReferenceTools({editor,outline,dialog,setDialog}) {
  const position=useEditorState({editor,selector:({editor:e})=>e.state.selection.from})
  const [levels,setLevels]=useState(3)
  const {headings,notes,tocs}=outline
  const entries=depth=>headings.filter(h=>h.level<=depth).map(({level,text})=>({level,text}))
  function updateToc() {
    const tr=editor.state.tr
    for(const {pos,node} of tocs) tr.setNodeMarkup(pos,undefined,{...node.attrs,entries:entries(node.attrs.levels)})
    editor.view.dispatch(tr)
  }
  function visit(list,step) {
    const note=step>0?(list.find(n=>n.pos>position) || list[0]):(list.findLast(n=>n.pos<position) || list.at(-1))
    editor.chain().focus().setNodeSelection(note.pos).scrollIntoView().run()
    setDialog({kind:note.node.attrs.kind,text:note.node.attrs.text,pos:note.pos,edit:true})
  }
  return <>
    <RibbonGroup label="目录">
      <button onMouseDown={e=>e.preventDefault()} onClick={()=>editor.chain().focus().insertContent({type:'wordToc',attrs:{levels,entries:entries(levels)}}).run()}><ListTree size={16}/>插入目录</button>
      <button disabled={!tocs.length} onClick={updateToc}><RefreshCw size={15}/>更新目录</button>
      <label>目录级别<select value={levels} onChange={e=>setLevels(+e.target.value)}>{[1,2,3,4,5,6].map(n=><option key={n} value={n}>{n} 级</option>)}</select></label>
    </RibbonGroup>
    {Object.entries(noteKinds).map(([kind,label])=>{
      const list=notes.filter(n=>n.node.attrs.kind===kind),Icon=kind==='footnote'?Footprints:CornerDownRight
      return <RibbonGroup key={kind} label={label}>
        <button onMouseDown={e=>e.preventDefault()} aria-pressed={dialog?.kind===kind && !dialog.edit} onClick={()=>setDialog({kind,text:'',edit:false})}><Icon size={16}/>{'插入'+label}</button>
        <button aria-label={'上一条'+label} title={'上一条'+label} disabled={!list.length} onClick={()=>visit(list,-1)}><ChevronUp size={15}/></button>
        <button aria-label={'下一条'+label} title={'下一条'+label} disabled={!list.length} onClick={()=>visit(list,1)}><ChevronDown size={15}/></button>
      </RibbonGroup>
    })}
  </>
}
export function WordNoteForm({editor,dialog,setDialog}) {
  const selection=useEditorState({editor,selector:({editor:e})=>({pos:e.state.selection.from,kind:e.state.selection.node?.attrs.kind})})
  const {text,kind,edit}=dialog
  const sameAnchor=selection.kind===kind && selection.pos===dialog.pos
  const valid=(!edit || sameAnchor) && text.trim()
  return <form className="word-reference-form" onSubmit={e=>{
    e.preventDefault()
    if(!valid)return
    if(edit) {
      const node=editor.state.doc.nodeAt(selection.pos)
      editor.view.dispatch(editor.state.tr.setNodeMarkup(selection.pos,undefined,{kind,text,native:node.attrs.text===text?node.attrs.native:null}))
    } else editor.chain().focus().insertContent({type:'wordNote',attrs:{kind,text}}).run()
    setDialog(null);editor.commands.focus()
  }}>
    <label>{noteKinds[kind]}正文<textarea autoFocus rows={2} value={text} onChange={e=>setDialog({...dialog,text:e.target.value})}/></label>
    <button disabled={!valid}>确定</button>
    {edit && <button type="button" disabled={!sameAnchor} onClick={()=>{editor.chain().focus().deleteSelection().run();setDialog(null)}}>删除{noteKinds[kind]}</button>}
    <button type="button" onClick={()=>{setDialog(null);editor.commands.focus()}}>取消</button>
  </form>
}
