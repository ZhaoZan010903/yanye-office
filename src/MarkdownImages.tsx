import React, { createContext, useContext, useEffect, useState } from 'react'
import Image from '@tiptap/extension-image'
import { Plugin } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { MAX_MARKDOWN_LENGTH } from '../shared/workspace.mjs'

export const MarkdownFile = createContext<string | undefined>(undefined)
const raster = /^image\/(?:png|jpeg|gif|webp|bmp|x-icon|vnd\.microsoft\.icon)$/iu
export const relativeReference = (ref: string) => !!ref && !/^(?:[a-z][a-z\d+.-]*:|[/\\]{2}|#)/iu.test(ref)

function MarkdownImageView({node}: NodeViewProps) {
  const disk = useContext(MarkdownFile)
  const src = String(node.attrs.src || '')
  const local = relativeReference(src)
  const [resource,setResource] = useState<{ref:string; url?:string; error?:string}>()
  useEffect(() => {
    if (!local) return
    let alive = true
    const reader = window.yanye?.library.markdownResource
    if (!disk || !reader) {
      setResource({ref:src,error:'将文稿保存到磁盘后可读取相对图片。'})
      return
    }
    Promise.resolve(reader(disk,src)).then(result => {
      const { mime, data } = result as {mime:string;data:string}
      if (alive) setResource({ref:src,url:'data:'+mime+';base64,'+data})
    }).catch(error => { if (alive) setResource({ref:src,error:String(error?.message || error)}) })
    return () => { alive = false }
  }, [src,local,disk])
  const resolved = local ? resource?.ref === src && resource.url : /^(https?:|data:image\/)/iu.test(src) && src
  const failed = local && resource?.ref === src && resource.error
  return <NodeViewWrapper as="span" className="md-image" contentEditable={false}>
    {resolved ? <img src={resolved} loading="lazy" draggable={false} alt={node.attrs.alt || ''} title={node.attrs.title || undefined}/> :
      <span className="md-image-missing" role={failed ? 'img' : 'status'} title={String(failed || src)}
        aria-label={failed ? '图片未能加载：' + src : undefined}>{node.attrs.alt || src || '图片'}</span>}
  </NodeViewWrapper>
}

function imageData(file: File) {
  return new Promise<string>((resolve,reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('无法读取图片 '+file.name))
    reader.readAsDataURL(file)
  })
}

export function markdownImages(active: () => boolean, report: (message:string) => void) {
  return Image.extend({
    renderMarkdown(node) {
      const {src='',alt='',title=''} = node.attrs || {}
      const label=String(alt || '').replace(/[\\[\]]/gu,'\\$&')
      const url=String(src || '')
      const destination=/[\s()<>]/u.test(url) ? '<'+url.replace(/[<>]/gu,c=>encodeURIComponent(c))+'>' : url
      const caption=title ? ' "'+String(title).replace(/["\\]/gu,'\\$&')+'"' : ''
      return '!['+label+']('+destination+caption+')'
    },
    addNodeView() { return ReactNodeViewRenderer(MarkdownImageView,{as:'span'}) },
    addProseMirrorPlugins() {
      const editor = this.editor
      const insert = (files:FileList | undefined, from:number, to=from) => {
        const images = Array.from(files || []).filter(file => raster.test(file.type))
        if (!images.length) return false
        const textLength = editor.state.doc.content.size
        const estimate = images.reduce((sum,file)=>sum+Math.ceil(file.size/3)*4+file.name.length+64,textLength)
        if (estimate > MAX_MARKDOWN_LENGTH) { report('图片超过当前文稿容量，可将图片放在文稿旁，再用相对路径插入。'); return true }
        // Keep the drop position attached to the original content while the file
        // reads. Undo should remove all images from one drop in a single step.
        const track = ({transaction}: {transaction:typeof editor.state.tr}) => {
          from=transaction.mapping.map(from)
          to=Math.max(from,transaction.mapping.map(to,-1))
        }
        editor.on('transaction',track)
        Promise.all(images.map(async file => ({
          type:'image',attrs:{src:await imageData(file),alt:file.name, title:null},
        }))).then(content => {
          if (!editor.isDestroyed && active()) editor.chain().focus().insertContentAt({from,to},content).run()
        }).catch(error => report(String(error?.message || error))).finally(()=>editor.off('transaction',track))
        return true
      }
      return [new Plugin({props:{
        handlePaste(view,event) { return insert(event.clipboardData?.files,view.state.selection.from,view.state.selection.to) },
        handleDOMEvents:{
          dragover(_view,event) {
            if (!Array.from(event.dataTransfer?.items || []).some(item => item.kind==='file' && raster.test(item.type))) return false
            event.preventDefault()
            return true
          },
          drop(view,event) {
            if (view.dragging || !event.dataTransfer?.files.length) return false
            const point=view.posAtCoords({left:event.clientX,top:event.clientY})
            if (!insert(event.dataTransfer.files,point?.pos ?? view.state.selection.from)) return false
            event.preventDefault()
            return true
          },
        },
      }})]
    },
  }).configure({inline:true,allowBase64:true})
}
