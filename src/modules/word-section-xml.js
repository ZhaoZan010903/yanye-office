// These parts of sectPr have no package relationships. Keep their native values
// (including doc grids, gutter and unequal column widths) when another section
// or unrelated text changes. Header/footer references are regenerated separately.
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const ordered=['footnotePr','endnotePr','type','pgSz','pgMar','paperSrc','pgBorders','lnNumType','pgNumType','cols','formProt','vAlign','noEndnote','titlePg','textDirection','bidi','rtlGutter','docGrid']
const nested=new Set(['col','top','left','bottom','right','pos','numFmt','numStart','numRestart'])
const attributeName=/^[A-Za-z][A-Za-z0-9]*$/

export function nativeSectionProperties(section,warn) {
  if(!section) return
  function copy(element) {
    const attributes={}
    for(const a of element.attributes) {
      if(a.namespaceURI===W && attributeName.test(a.localName)) attributes[a.localName]=a.value
      else if(a.prefix==='r') warn('带图片关系的节边框需要原应用')
    }
    const children=[...element.children].filter(el=>el.namespaceURI===W && nested.has(el.localName)).map(copy)
    return {tag:element.localName,attributes,...(children.length?{children}:{})}
  }
  return Object.fromEntries([...section.children].filter(el=>el.namespaceURI===W && ordered.includes(el.localName)).map(el=>[el.localName,copy(el)]))
}

export function sectionPropertiesXml(layout, width, height, escape) {
  const twips=mm=>Math.round(mm*1440/25.4)
  const native=layout.nativeSection || {}
  const props={...native}
  function set(tag,values) {
    const attributes={...(props[tag]?.attributes||{}),...values}
    props[tag]={...props[tag],tag,attributes}
  }
  if(layout.start) set('type',{val:layout.start})
  set('pgSz',{w:twips(width),h:twips(height),orient:layout.landscape?'landscape':undefined})
  set('pgMar',{...Object.fromEntries(['top','right','bottom','left'].map(side=>[side,twips(layout[side])])),
    header:twips(layout.headerDistance??12.7),footer:twips(layout.footerDistance??12.7),gutter:native.pgMar?.attributes?.gutter??0})
  if(layout.pageStart) set('pgNumType',{start:layout.pageStart})
  if(layout.columns || layout.columnGap!=null) {
    set('cols',{num:layout.columns||1,space:twips(layout.columnGap??12.7)})
    if(props.cols.children?.length && props.cols.children.length!==layout.columns) {
      props.cols={...props.cols,attributes:{...props.cols.attributes,equalWidth:'1'},children:[]}
    }
  }
  if(layout.differentFirst) set('titlePg',{val:undefined})
  else delete props.titlePg
  function emit(tag,node,depth=0) {
    const attrs=Object.entries(node?.attributes||{}).filter(([key,value])=>attributeName.test(key)&&value!=null)
      .map(([key,value])=>' w:'+key+'="'+escape(value)+'"').join('')
    const inside=depth===0 && Array.isArray(node?.children)?node.children.filter(x=>nested.has(x?.tag)).map(x=>emit(x.tag,x,1)).join(''):''
    return inside?'<w:'+tag+attrs+'>'+inside+'</w:'+tag+'>':'<w:'+tag+attrs+'/>'
  }
  return ordered.filter(tag=>props[tag]).map(tag=>emit(tag,props[tag])).join('')
}
