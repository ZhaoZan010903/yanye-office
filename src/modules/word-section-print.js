import {paperDimensions,sectionLayout,inheritedBands,validColor} from './word-model.js'
import {bandPrintStyles} from './word-bands.js'
import { DOMSerializer } from '@tiptap/pm/model'
import { revisions, reviewTransaction } from './word-revisions.js'

export function sectionPrintModel(editor, finalLayout, pageColor) {
  const container=document.createElement('div')
  // Print the final text without changing the author's pending review history.
  // Hiding a deleted run in CSS cannot remove a deleted paragraph boundary.
  const pending=revisions(editor.state.doc)
  const doc=pending.length ? reviewTransaction(editor.state,pending,true).doc : editor.state.doc
  container.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(doc.content))
  const layouts=[]
  editor.state.doc.forEach(node=>{ if (node.type.name==='sectionBreak') layouts.push(sectionLayout(node.attrs.layout)) })
  layouts.push(finalLayout)
  const content=['']
  const footnotes=[],endnotes=[],counts={footnote:0,endnote:0}
  function emitNotes(list) {
    if(!list.length)return ''
    const aside=document.createElement('aside')
    aside.className='word-print-notes'
    for(const text of list){const line=document.createElement('div');line.textContent=text;aside.append(line)}
    list.length=0
    return aside.outerHTML
  }
  for (const element of container.children) {
    if(element.hasAttribute('data-word-section')) {
      content[content.length-1]+=emitNotes(footnotes)
      content.push('')
    } else {
      for(const marker of element.querySelectorAll('[data-note-kind]')) {
        const kind=marker.dataset.noteKind,number=++counts[kind]
        marker.textContent=String(number)
        ;(kind==='endnote'?endnotes:footnotes).push(number+' '+marker.title)
      }
      content[content.length-1]+=element.outerHTML
    }
  }
  content[content.length-1]+=emitNotes(footnotes)+emitNotes(endnotes)
  let priorBands={}
  return layouts.map((raw,i)=>{
    const layout=inheritedBands(raw,priorBands)
    priorBands=layout.bands
    const name='yanyeSection'+i
    const [width,height]=paperDimensions(layout)
    const margin=[layout.top,layout.right,layout.bottom,layout.left].map(mm=>mm+'mm').join(' ')
    const color=validColor(pageColor) ? 'background-color:'+pageColor+';' : ''
    const css='@page '+name+'{size:'+width+'mm '+height+'mm;margin:'+margin+';'+color+'}'+bandPrintStyles(layout).replaceAll('@page','@page '+name)
    return {name,layout,css,html:content[i]}
  })
}
