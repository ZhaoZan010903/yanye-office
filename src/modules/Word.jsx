import Ribbon, { RibbonGroup } from '../office/Ribbon'
import React, { useEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, FileDown, ImagePlus, Italic, List, ListOrdered, Redo2, Search, Strikethrough, Subscript, Superscript, Table2, Underline, Undo2 } from 'lucide-react'
import { findText, highlights, maxImageBytes, paperDimensions, papers, validColor, validFont, wordValue } from './word-model.js'
import { bandPrintStyles, pageBand } from './word-bands.js'
import WordBands from './WordBands.jsx'
import WordComments,{WordComment} from './WordComments.jsx'
import FontPicker from './FontPicker.jsx'
import './word.css'

const WordStyle = Mark.create({
  name:'wordStyle',
  addAttributes() {
    return {
      font:{default:null,parseHTML:el=>{
        const name=el.dataset.eastFont ?? el.style.fontFamily.replace(/["']/g,'')
        return validFont(name) ? name : null
      }},
      latinFont:{default:null,parseHTML:el=>validFont(el.dataset.latinFont) ? el.dataset.latinFont : null},
      size:{default:null,parseHTML:el=>Number(el.dataset.baseSize) || (/pt$/.test(el.style.fontSize)?parseFloat(el.style.fontSize):null)},
      color:{default:null,parseHTML:el=>validColor(el.dataset.color)?el.dataset.color:(validColor(el.style.color)?el.style.color:null)},
      highlight:{default:null,parseHTML:el=>Object.hasOwn(highlights,el.dataset.highlight) ? el.dataset.highlight : null},
      script:{default:null,parseHTML:el=>({super:'superscript',sub:'subscript'})[el.style.verticalAlign] ?? null},
    }
  },
  parseHTML() { return [{tag:'span[style]'}] },
  renderHTML({ mark }) {
    const {font,latinFont,size,color,highlight,script}=mark.attrs
    const styles=[], attributes={}
    const families=[...new Set([latinFont,font].filter(validFont))]
    if (families.length) styles.push('font-family:' + families.map(f=>'"'+f+'"').join(','))
    if (validFont(font)) attributes['data-east-font']=font
    if (validFont(latinFont)) attributes['data-latin-font']=latinFont
    if (size>0 && size<=400) styles.push('font-size:' + size + 'pt')
    if (validColor(color)) {styles.push('color:' + color); attributes['data-color']=color}
    if (Object.hasOwn(highlights,highlight)) {
      styles.push('background-color:'+highlights[highlight][1])
      attributes['data-highlight']=highlight
    }
    if (script==='superscript' || script==='subscript') {
      styles.push('vertical-align:'+(script==='superscript'?'super':'sub'))
      styles.push('font-size:'+(size>0 ? size*0.7+'pt' : '70%'))
      if (size>0) attributes['data-base-size']=size
    }
    return ['span',{...attributes,style:styles.join(';')},0]
  },
})

function paragraphLength(key, cssProperty, unit='pt') {
  return {default:null,parseHTML:el=>{
    const value=el.style.getPropertyValue(cssProperty)
    return value.endsWith(unit) ? parseFloat(value) : null
  },renderHTML:attrs=>Number.isFinite(attrs[key]) ? {style:cssProperty+':'+attrs[key]+unit} : {}}
}

const ParagraphFormat=Extension.create({
  name:'wordParagraph',
  addGlobalAttributes() {
    return [{types:['heading','paragraph'],attributes:{
      align:{default:null,parseHTML:el=>el.style.textAlign || null,renderHTML:a=>['left','right','center','justify'].includes(a.align)?{style:'text-align:' + a.align}:{}},
      lineSpacing:{default:null,parseHTML:el=>Number(el.style.lineHeight) || null,renderHTML:a=>a.lineSpacing>0?{style:'line-height:' + Number(a.lineSpacing)}:{}},
      spaceBefore:paragraphLength('spaceBefore','margin-top'),
      spaceAfter:paragraphLength('spaceAfter','margin-bottom'),
      leftIndent:paragraphLength('leftIndent','margin-left'),
      firstLinePt:paragraphLength('firstLinePt','text-indent'),
      firstLineChars:paragraphLength('firstLineChars','text-indent','em'),
    }}]
  },
})

const PageBreak=Node.create({
  name:'pageBreak', group:'block', atom:true, selectable:true,
  parseHTML(){return [{tag:'div[data-word-page-break]'}]},
  renderHTML(){return ['div',{'data-word-page-break':'','aria-label':'分页符',class:'word-page-break'}]},
  addKeyboardShortcuts(){return {'Mod-Enter':()=>this.editor.commands.insertContent({type:'pageBreak'})}},
})

const LocalImage=Image.extend({
  parseHTML() { return [{tag:'img[src]',getAttrs:el=>/^data:image\/(?:png|jpeg);base64,/i.test(el.getAttribute('src'))?{}:false}] },
  renderHTML({HTMLAttributes}) { return ['img',mergeAttributes(HTMLAttributes,{draggable:'false'})] },
}).configure({allowBase64:true,inline:true})

const extensions=[StarterKit.configure({blockquote:false,code:false,codeBlock:false,horizontalRule:false,link:{openOnClick:false,autolink:false}}), WordStyle,WordComment,ParagraphFormat,PageBreak,LocalImage,TableKit]
const pointNames={42:'初号',36:'小初',26:'一号',24:'小一',22:'二号',18:'小二',16:'三号',15:'小三',14:'四号',12:'小四',10.5:'五号',9:'小五',7.5:'六号',6.5:'小六',5.5:'七号',5:'八号'}
const sizes=[8,10,11,20,28,32,48,72,...Object.keys(pointNames).map(Number)]
const aligns=[['left','左对齐',AlignLeft],['center','居中对齐',AlignCenter],['right','右对齐',AlignRight],['justify','两端对齐',AlignJustify]]
const markButtons=[['bold','粗体',Bold,'toggleBold'],['italic','斜体',Italic,'toggleItalic'],['underline','下划线',Underline,'toggleUnderline'],['strike','删除线',Strikethrough,'toggleStrike']]

function Action({icon: Icon,label,onClick,pressed,disabled,compact=false}) {
  return <button type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled}
    onMouseDown={e=>e.preventDefault()} onClick={onClick}>{Icon && <Icon size={15} aria-hidden="true"/>}{!compact && label}</button>
}
function imageFile(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader()
    reader.onerror=()=>reject(new Error('无法读取图片'))
    reader.onload=()=>resolve(reader.result)
    reader.readAsDataURL(file)
  })
}

export default function Word({value, onChange, onPrintPdf, title}) {
  const current=wordValue(value)
  const latest=useRef(current), callback=useRef(onChange), accepted=useRef(current.doc)
  latest.current=current; callback.current=onChange
  const [tab,setTab]=useState('开始'), [message,setMessage]=useState(''), [searching,setSearching]=useState(false)
  const [bandsOpen,setBandsOpen]=useState(false)
  const [term,setTerm]=useState(''), [replacement,setReplacement]=useState('')
  const [print,setPrint]=useState(null), [printing,setPrinting]=useState(false)
  const [rows,setRows]=useState(3), [columns,setColumns]=useState(3), [zoom,setZoom]=useState(100)
  const fileRef=useRef(null), searchRef=useRef(null), alive=useRef(true)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  const editor=useEditor({
    extensions,content:current.doc,
    editorProps:{attributes:{class:'word-prose',role:'textbox','aria-label':'Word 文档正文','aria-multiline':'true'}},
    onUpdate:({editor:instance})=>{
      const doc=instance.getJSON(), next={...latest.current,doc}
      if (callback.current(next)===false) {
        instance.commands.setContent(accepted.current,{emitUpdate:false})
        setMessage('工作区容量不足，已保留上次保存的正文。')
      } else { latest.current=next; accepted.current=doc }
    },
  },[])
  useEffect(()=>{
    if (editor && accepted.current!==current.doc) {
      accepted.current=current.doc
      editor.commands.setContent(current.doc,{emitUpdate:false})
    }
  },[editor,current.doc])
  const format=useEditorState({editor,selector:({editor:e})=>{
    if (!e) return null
    const a=e.getAttributes(e.isActive('heading')?'heading':'paragraph')
    return {marks:Object.fromEntries(markButtons.map(([m])=>[m,e.isActive(m)])), run:e.getAttributes('wordStyle'),
      heading:e.isActive('heading')?a.level:0,align:a.align || 'left',spacing:a.lineSpacing || 1.25,paragraph:a,
      bullet:e.isActive('bulletList'),numbered:e.isActive('orderedList'),table:e.isActive('table'),undo:e.can().undo(),redo:e.can().redo(),
      chars:e.state.doc.textContent.length}
  }})
  const layout=current.layout, [width,height]=paperDimensions(layout)
  const changeLayout=patch=>onChange({...latest.current,layout:{...latest.current.layout,...patch}})
  function run(cmd,...args){editor.chain().focus()[cmd](...args).run()}
  function paragraphPatch(patch){editor.chain().focus().updateAttributes('paragraph',patch).updateAttributes('heading',patch).run()}
  function applyStyle(patch){editor.chain().focus().setMark('wordStyle',{...editor.getAttributes('wordStyle'),...patch}).run()}
  function search(action) {
    const hits=findText(editor.state.doc,term)
    if (!hits.length) {setMessage('没有找到匹配文字。');return}
    const {from,to}=editor.state.selection
    const exact=hits.find(h=>h.from===from && h.to===to)
    if (action==='all' || (action==='one' && exact)) {
      const target=action==='all'?hits:[exact], tr=editor.state.tr
      for(const h of target.toReversed()) tr.insertText(replacement,h.from,h.to)
      editor.view.dispatch(tr)
      setMessage('已替换 ' + target.length + ' 处。')
      return
    }
    const next=hits.find(h=>h.from>=to) || hits[0]
    editor.chain().setTextSelection(next).scrollIntoView().run()
    setMessage('第 ' + (hits.indexOf(next)+1) + ' 处，共 ' + hits.length + ' 处。')
  }
  async function insertImage(e) {
    const file=e.target.files[0]; e.target.value=''
    if (!file) return
    try {
      if (!['image/png','image/jpeg'].includes(file.type) || file.size>maxImageBytes) throw new Error('请选择 4 MiB 以内的 PNG 或 JPEG 图片。')
      const src=await imageFile(file), img=new window.Image()
      img.src=src; await img.decode()
      if (!alive.current) return
      const scale=Math.min(1,(width-layout.left-layout.right)*96/25.4/img.naturalWidth)
      run('setImage',{src,alt:file.name,width:Math.round(img.naturalWidth*scale),height:Math.round(img.naturalHeight*scale)})
    } catch(error){if(alive.current)setMessage(error.message)}
  }
  async function printPdf(){
    if (!editor || printing || !onPrintPdf) return
    setPrinting(true); setMessage('')
    try {
      flushSync(()=>setPrint(editor.getHTML()))
      await Promise.all([document.fonts.ready,...[...document.querySelectorAll('.word-print-root img')].map(i=>i.decode())])
      if (alive.current) await onPrintPdf((title || 'Word 文档')+'.pdf', { widthMm: width, heightMm: height })
    } catch(error){if(alive.current)setMessage(error.message)}
    finally {if(alive.current){setPrint(null);setPrinting(false)}}
  }
  useEffect(()=>{
    const key=e=>{
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      if (['f','h'].includes(e.key.toLowerCase())) {e.preventDefault();setSearching(true);requestAnimationFrame(()=>searchRef.current?.focus())}
      if (e.key.toLowerCase()==='p'){e.preventDefault();void printPdf()}
    }
    window.addEventListener('keydown',key)
    return ()=>window.removeEventListener('keydown',key)
  })
  if (!editor || !format) return null
  const activeFont=format.run.font ?? 'Microsoft YaHei', activeSize=Number(format.run.size) || 11
  const marginText=[layout.top,layout.right,layout.bottom,layout.left].map(v=>v+'mm').join(' ')
  const firstType=layout.differentFirst?'first':'default'
  function bandPreview(kind) {
    const band=pageBand(layout,firstType,kind)
    return band.text && <div className={'word-band-preview word-'+kind} style={{textAlign:band.align}}
      title={kind==='header'?'页眉':'页脚'}>{band.text.replaceAll('{{PAGE}}','1').replaceAll('{{NUMPAGES}}','…')}</div>
  }
  const customMargin=![12.7,25.4,38.1].some(n=>[layout.top,layout.right,layout.bottom,layout.left].every(v=>Math.abs(v-n)<0.06))
  return <section className="word-editor" aria-label="文字处理">
    <Ribbon label="文字" active={tab} onChange={setTab} tabs={['开始','插入','布局','审阅','视图']}>
      <Action label="查找替换" icon={Search} onClick={()=>{setSearching(!searching);requestAnimationFrame(()=>searchRef.current?.focus())}}/>
      <Action label="导出 PDF" icon={FileDown} onClick={printPdf} disabled={printing || !onPrintPdf}/>
    </Ribbon>
    {tab!=='审阅' && <div className="word-tools ribbon-panel" role="toolbar" aria-label={tab+'工具'}>
      {tab==='开始' && <><RibbonGroup label="编辑">
        <Action compact icon={Undo2} label="撤销" onClick={()=>run('undo')} disabled={!format.undo}/><Action compact icon={Redo2} label="重做" onClick={()=>run('redo')} disabled={!format.redo}/>
        </RibbonGroup><RibbonGroup label="样式与字体">
        <select aria-label="段落样式" value={format.heading} onChange={e=>Number(e.target.value)?run('setHeading',{level:Number(e.target.value)}):run('setParagraph')}>
          <option value="0">正文</option>{[1,2,3,4,5,6].map(v=><option key={v} value={v}>标题 {v}</option>)}</select>
        <FontPicker label="字体" value={activeFont} onChange={font=>applyStyle({font})}/>
        <FontPicker label="西文字体" value={format.run.latinFont || ''} defaultLabel="西文随字体" onChange={font=>applyStyle({latinFont:font || null})}/>
        <select aria-label="字号" value={activeSize} onChange={e=>applyStyle({size:Number(e.target.value)})}>
          {[...new Set([...sizes,activeSize])].sort((a,b)=>a-b).map(s=><option key={s} value={s}>{pointNames[s] ? pointNames[s]+' · ' : ''}{s} pt</option>)}</select>
        {markButtons.map(([m,label,icon,cmd])=><Action compact key={m} icon={icon} label={label} pressed={format.marks[m]} onClick={()=>run(cmd)}/>)}
        <label className="word-color" title="文字颜色">A<input aria-label="文字颜色" type="color" value={format.run.color || '#37352f'} onChange={e=>applyStyle({color:e.target.value})}/></label>
        <select aria-label="荧光标记" value={format.run.highlight || ''} onChange={e=>applyStyle({highlight:e.target.value || null})}>
          <option value="">无荧光标记</option>{Object.entries(highlights).map(([key,[label]])=><option value={key} key={key}>{label}荧光</option>)}</select>
        {[[Superscript,'上标','superscript'],[Subscript,'下标','subscript']].map(([icon,label,key])=><Action compact key={key} icon={icon} label={label}
          pressed={format.run.script===key} onClick={()=>applyStyle({script:format.run.script===key ? null : key})}/>)}
        </RibbonGroup><RibbonGroup label="段落">
        {aligns.map(([a,label,icon])=><Action compact key={a} label={label} icon={icon} pressed={format.align===a} onClick={()=>paragraphPatch({align:a})}/>)}
        <Action compact label="项目符号" icon={List} pressed={format.bullet} onClick={()=>run('toggleBulletList')}/><Action compact label="编号列表" icon={ListOrdered} pressed={format.numbered} onClick={()=>run('toggleOrderedList')}/>
        <label>行距 <select aria-label="行距" value={format.spacing} onChange={e=>paragraphPatch({lineSpacing:Number(e.target.value)})}>
          {[...new Set([1,1.25,1.5,2,format.spacing])].sort((a,b)=>a-b).map(n=><option key={n}>{n}</option>)}</select></label>
      </RibbonGroup></>}
      {tab==='插入' && <><RibbonGroup label="页眉和页脚">
        <Action label="页眉页脚" pressed={bandsOpen} onClick={()=>setBandsOpen(!bandsOpen)}/>
        </RibbonGroup><RibbonGroup label="表格">
        <label>行 <input aria-label="表格行数" type="number" min="1" max="30" value={rows} onChange={e=>setRows(e.target.value)}/></label>
        <label>列 <input aria-label="表格列数" type="number" min="1" max="12" value={columns} onChange={e=>setColumns(e.target.value)}/></label>
        <Action label="插入表格" icon={Table2} disabled={!Number.isInteger(+rows)||+rows<1||+rows>30||!Number.isInteger(+columns)||+columns<1||+columns>12} onClick={()=>run('insertTable',{rows:+rows,cols:+columns,withHeaderRow:true})}/>
        {format.table && <><span className="word-divider"/>{[['加行','addRowAfter'],['加列','addColumnAfter'],['删除行','deleteRow'],['删除列','deleteColumn'],['合并单元格','mergeCells'],['拆分单元格','splitCell'],['删除表格','deleteTable']].map(([label,cmd])=><Action key={cmd} label={label} disabled={!editor.can()[cmd]()} onClick={()=>run(cmd)}/>)}</>}
        </RibbonGroup><RibbonGroup label="插图和分页">
        <Action label="插入图片" icon={ImagePlus} onClick={()=>fileRef.current.click()}/>
        <Action label="插入分页符" onClick={()=>run('insertContent',{type:'pageBreak'})}/>
      </RibbonGroup></>}
      {tab==='布局' && <><RibbonGroup label="段落间距">
        <label>首行 <select aria-label="首行缩进" value={format.paragraph.firstLineChars ?? (format.paragraph.firstLinePt ? 'pt' : 0)}
          onChange={e=>paragraphPatch({firstLineChars:Number(e.target.value),firstLinePt:null})}>
          {[...new Set([0,1,2,3,...(Number.isFinite(format.paragraph.firstLineChars)?[format.paragraph.firstLineChars]:[])])].map(n=><option key={n} value={n}>{n} 字符</option>)}
          {format.paragraph.firstLinePt && <option value="pt">{format.paragraph.firstLinePt} pt</option>}</select></label>
        {[['段前','spaceBefore'],['段后','spaceAfter']].map(([label,key])=>{
          const current=format.paragraph[key]
          return <label key={key}>{label}<select aria-label={label+'间距'} value={current ?? ''} onChange={e=>paragraphPatch({[key]:e.target.value==='' ? null : Number(e.target.value)})}>
            <option value="">样式默认</option>{[...new Set([0,3,6,9,12,18,24,...(Number.isFinite(current)?[current]:[])])].sort((a,b)=>a-b).map(n=><option key={n} value={n}>{n} pt</option>)}</select></label>
        })}
        </RibbonGroup><RibbonGroup label="页面设置">
        <label>纸张 <select aria-label="纸张大小" value={layout.paper} onChange={e=>changeLayout({paper:e.target.value})}>
          {Object.keys(papers).map(p=><option key={p}>{p}</option>)}{layout.paper==='custom'&&<option value="custom">文档自定义</option>}</select></label>
        <label>方向 <select aria-label="纸张方向" value={layout.landscape?'landscape':'portrait'} onChange={e=>changeLayout({landscape:e.target.value==='landscape'})}><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
        <label>页边距 <select aria-label="页边距" value={customMargin?'custom':[12.7,25.4,38.1].find(n=>Math.abs(layout.top-n)<0.06)} onChange={e=>{const n=Number(e.target.value);changeLayout({top:n,bottom:n,left:n,right:n})}}>
          <option value="12.7">窄 · 1.27 厘米</option><option value="25.4">普通 · 2.54 厘米</option><option value="38.1">宽 · 3.81 厘米</option>{customMargin && <option value="custom">文档自定义</option>}</select></label>
      </RibbonGroup></>}
      {tab==='视图' && <><RibbonGroup label="显示比例">
        {[75,100,125,150].map(n=><Action key={n} label={n+'%'} pressed={zoom===n} onClick={()=>setZoom(n)}/>)}
      </RibbonGroup><RibbonGroup label="导航">
        <Action label="跳至文首" onClick={()=>editor.commands.focus('start')}/>
        <Action label="跳至文末" onClick={()=>editor.commands.focus('end')}/>
      </RibbonGroup></>}
    </div>}
    {bandsOpen && tab==='插入' && <WordBands layout={layout} onChange={changeLayout}/>}
    {tab==='审阅' && <WordComments editor={editor}/>}
    {searching && <div className="word-find"><input ref={searchRef} aria-label="查找文字" placeholder="查找文字" value={term} onChange={e=>setTerm(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')search('next')}}/>
      <input aria-label="替换文字" placeholder="替换为" value={replacement} onChange={e=>setReplacement(e.target.value)}/>
      {[['下一处','next'],['替换当前','one'],['全部替换','all']].map(([label,key])=><Action key={key} label={label} disabled={!term} onClick={()=>search(key)}/>)}
      <button onClick={()=>{setSearching(false);setMessage('');editor.commands.focus()}}>关闭查找</button></div>}
    {current.compatibility.length>0 && <details className="word-compat"><summary>此文档中有简化显示的内容</summary>{current.compatibility.join('；')}</details>}
    {message && <p role="status" className="word-message">{message}<button onClick={()=>setMessage('')}>关闭提示</button></p>}
    <input hidden ref={fileRef} type="file" accept="image/png,image/jpeg" onChange={insertImage} aria-label="选择文档图片"/>
    <div className="word-scroll"><div className="word-sheet" style={{width:width+'mm',minHeight:height+'mm',padding:marginText,zoom:zoom/100}}>
      {bandPreview('header')}<EditorContent editor={editor}/>{bandPreview('footer')}
    </div></div>
    <div className="word-status"><span>{layout.paper} · {layout.landscape?'横向':'纵向'}</span><span>{format.chars} 字符</span><label>缩放 <select aria-label="文档缩放" value={zoom} onChange={e=>setZoom(Number(e.target.value))}>
      {[60,75,85,100,125,150].map(n=><option key={n} value={n}>{n}%</option>)}</select></label></div>
    {print!==null && createPortal(<div className="word-print-root">
      <style>{'@media print { @page { size: '+width+'mm '+height+'mm; margin: '+marginText+'; } '+bandPrintStyles(layout)+' html,body { overflow:visible !important; height:auto !important; margin:0 !important; } body > :not(.word-print-root) {display:none !important;} .word-print-root {display:block !important;} }'}</style>
      <div className="word-prose" dangerouslySetInnerHTML={{__html:print}}/>
    </div>,document.body)}
  </section>
}
