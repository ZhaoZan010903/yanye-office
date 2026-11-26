import {paperDimensions,sectionLayout,inheritedBands} from './word-model.js'
import {bandPrintStyles} from './word-bands.js'
import { DOMSerializer } from '@tiptap/pm/model'
import { revisions, reviewTransaction } from './word-revisions.js'

export function sectionPrintModel(editor, finalLayout) {
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
  for (const element of container.children) {
    if(element.hasAttribute('data-word-section')) content.push('')
    else content[content.length-1]+=element.outerHTML
  }
  let priorBands={}
  return layouts.map((raw,i)=>{
    const layout=inheritedBands(raw,priorBands)
    priorBands=layout.bands
    const name='yanyeSection'+i
    const [width,height]=paperDimensions(layout)
    const margin=[layout.top,layout.right,layout.bottom,layout.left].map(mm=>mm+'mm').join(' ')
    const css='@page '+name+'{size:'+width+'mm '+height+'mm;margin:'+margin+';}'+bandPrintStyles(layout).replaceAll('@page','@page '+name)
    return {name,layout,css,html:content[i]}
  })
}
