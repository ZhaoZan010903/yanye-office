import {elem,elements,first,textOf,emitOffice} from './word-native-object.js'
const emu=12700
const twipsFrom=(node,tag)=>Number(textOf(first(node,tag)) || 0)/emu
export const defaultBox={text:'文本框',x:18,y:10,width:144,height:48,fill:'#ffffff',line:'#37352f'}
const rgb=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(value)?value.slice(1).toUpperCase():fallback
function paragraphText(p){
  return (p.children||[]).map(n=>typeof n==='string'?'':n.tag==='w:t'?textOf(n):n.tag==='w:tab'?'\t':n.tag==='w:br'?'\n':paragraphText(n)).join('')
}
export function canEditBoxText(tree){
  if(!tree)return true
  const container=first(tree,'w:txbxContent')
  const children=node=>node.children.filter(n=>typeof n==='object')
  return !!container && children(container).every(p=>p.tag==='w:p' && children(p).every(r=>
    r.tag==='w:pPr' || r.tag==='w:proofErr' || (r.tag==='w:r' && children(r).every(n=>['w:rPr','w:t','w:tab','w:br'].includes(n.tag)))))
}
export function readBox(tree){
  const anchor=first(tree,'wp:anchor'), content=first(tree,'w:txbxContent')
  if(!anchor || !content)return null
  const size=first(anchor,'wp:extent')?.attrs
  const props=first(tree,'wps:spPr'), fill=props?.children?.find(n=>n.tag==='a:solidFill')
  return {text:content.children.filter(n=>n.tag==='w:p').map(paragraphText).join('\n'),
    x:twipsFrom(first(anchor,'wp:positionH'),'wp:posOffset'),y:twipsFrom(first(anchor,'wp:positionV'),'wp:posOffset'),
    width:Number(size?.cx)/emu || defaultBox.width,height:Number(size?.cy)/emu || defaultBox.height,
    fill:'#'+(first(fill,'a:srgbClr')?.attrs.val || 'ffffff'),
    line:'#'+(first(first(props,'a:ln'),'a:srgbClr')?.attrs.val || '37352f'),native:tree}
}
function textRuns(line,style){
  const runs=line.split('\t').flatMap((part,i)=>[...(i?[elem('w:tab')]:[]),elem('w:t',{'xml:space':'preserve'},[part])])
  return elem('w:r',{},[...(style?[structuredClone(style)]:[]),...runs])
}
function updateParagraph(p,text){
  const nodes=elements(p,'w:t'),old=paragraphText(p)
  if(old===text)return
  // Preserve every unchanged run, including its character formatting, on ordinary text edits.
  if(nodes.length && !/[\n\t]/.test(old+text)){
    let left=0,right=0
    while(left<old.length && left<text.length && old[left]===text[left])left++
    while(right<old.length-left && right<text.length-left && old[old.length-1-right]===text[text.length-1-right])right++
    let start=0,inserted=false
    for(const node of nodes){
      const current=textOf(node),end=start+current.length
      const prefix=current.slice(0,Math.max(0,left-start))
      const suffix=current.slice(Math.max(0,old.length-right-start))
      let replacement=''
      if(!inserted && left<=end){replacement=text.slice(left,text.length-right);inserted=true}
      node.children=[prefix+replacement+suffix];node.attrs['xml:space']='preserve';start=end
    }
  }else p.children=[...p.children.filter(n=>n.tag==='w:pPr'),textRuns(text,first(p,'w:rPr'))]
}
function moveAxis(anchor,tag,value){
  const axis=first(anchor,tag)
  if(axis)axis.children=[elem('wp:posOffset',{},[String(Math.round(value*emu))])]
}
function recolor(parent,color){
  if(!parent)return
  const index=parent.children.findIndex(n=>['a:noFill','a:solidFill','a:gradFill','a:pattFill'].includes(n.tag))
  const fill=elem('a:solidFill',{},[elem('a:srgbClr',{val:rgb(color,'FFFFFF')})])
  if(index>=0)parent.children.splice(index,1,fill)
  else{
    const before=parent.children.findIndex(n=>['a:ln','a:effectLst','a:effectDag','a:extLst'].includes(n.tag))
    parent.children.splice(before<0?parent.children.length:before,0,fill)
  }
}
export function textboxXml(attrs,id){
  const a={...defaultBox,...attrs}
  const valid=Number.isFinite
  if(![a.width,a.height,a.x,a.y].every(valid) || a.width<=0 || a.height<=0)throw Error('文本框的位置或大小无效。')
  const cx=Math.round(a.width*emu),cy=Math.round(a.height*emu)
  if(a.native){
    const original=readBox(a.native)
    if(!original)throw Error('原文本框形状无效。')
    const tree=structuredClone(a.native),anchor=first(tree,'wp:anchor'),extent=first(anchor,'wp:extent')
    const docPr=first(tree,'wp:docPr');docPr.attrs.id=String(id)
    if(a.x!==original.x)moveAxis(anchor,'wp:positionH',a.x)
    if(a.y!==original.y)moveAxis(anchor,'wp:positionV',a.y)
    if(a.width!==original.width || a.height!==original.height){
      Object.assign(extent.attrs,{cx,cy})
      const inner=first(first(tree,'a:xfrm'),'a:ext')
      if(inner)Object.assign(inner.attrs,{cx,cy})
    }
    if(a.text!==original.text){
      if(!canEditBoxText(a.native))throw Error('此文本框含有域或表格等对象，请在原应用中编辑框内正文。')
      const container=first(tree,'w:txbxContent'),paragraphs=container.children.filter(n=>n.tag==='w:p')
      const lines=a.text.split('\n')
      container.children=lines.map((line,i)=>{
        const p=i<paragraphs.length?paragraphs[i]:elem('w:p',{},[textRuns('',first(paragraphs.at(-1),'w:rPr'))])
        updateParagraph(p,line);return p
      })
    }
    const style=first(tree,'wps:spPr')
    if(a.fill!==original.fill)recolor(style,a.fill)
    if(a.line!==original.line){
      let ln=first(style,'a:ln')
      if(!ln){ln=elem('a:ln',{w:'12700'});style.children.push(ln)}
      recolor(ln,a.line)
    }
    return '<w:r>'+emitOffice(tree)+'</w:r>'
  }
  const paragraphs=String(a.text).split('\n').map(line=>'<w:p>'+emitOffice(textRuns(line))+'</w:p>').join('')
  return '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="'+id+'" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">'+
    '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>'+Math.round(a.x*emu)+'</wp:posOffset></wp:positionH>'+
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>'+Math.round(a.y*emu)+'</wp:posOffset></wp:positionV><wp:extent cx="'+cx+'" cy="'+cy+'"/><wp:wrapNone/>'+
    '<wp:docPr id="'+id+'" name="文本框 '+id+'"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'+
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'+
    '<a:solidFill><a:srgbClr val="'+rgb(a.fill,'FFFFFF')+'"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="'+rgb(a.line,'37352F')+'"/></a:solidFill></a:ln></wps:spPr>'+
    '<wps:txbx><w:txbxContent>'+paragraphs+'</w:txbxContent></wps:txbx><wps:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720"><a:noAutofit/></wps:bodyPr>'+
    '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
}
