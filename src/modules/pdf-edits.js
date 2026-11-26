export function initialPdfPages(count) {
  return Array.from({ length:count }, (_, i) => ({ source:i + 1, rotation:0 }))
}

export function movePdfPage(pages, from, to) {
  if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return pages
  const next = pages.slice()
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

export function parsePdfPageRange(input, count) {
  const out=[], used=new Set()
  for (const item of String(input).split(/[,，、]/u)) {
    const match=/^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/u.exec(item)
    const first=Number(match?.[1]), last=Number(match?.[2] || first)
    if (!match || first<1 || !Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last<first || last>count) {
      throw new Error('页码范围无效，请输入 1 到 '+count+' 之间的页码，例如 1,3-5。')
    }
    for (let n=first;n<=last;n++) {
      if (used.has(n)) throw new Error('页码 '+n+' 重复，请每页只选择一次。')
      used.add(n);out.push(n-1)
    }
  }
  return out
}

async function preparedPdf(bytes,pages,{PDFDocument,PDFName,PDFHexString,degrees}) {
  const source = await PDFDocument.load(bytes, {updateMetadata:false})
  if (!pages) return source
  const count = source.getPageCount()
  if (!Array.isArray(pages) || !pages.length || pages.length > count ||
      new Set(pages.map(p => p.source)).size !== pages.length ||
      pages.some(p => !Number.isInteger(p.source) || p.source < 1 || p.source > count || ![0,90,180,270].includes(p.rotation))) {
    throw new Error('页面整理记录与 PDF 原件不一致。')
  }
  // Keeping existing indirect references preserves links between retained pages.
  const original = source.getPages().slice()
  if (pages.length !== count || pages.some((p, index) => p.source !== index+1)) {
    // Reparenting a page must preserve the boxes, rotation and font resources inherited from its old branch.
    for (const {source:index} of pages) {
      const node = original[index-1].node
      for (const key of [PDFName.Resources,PDFName.MediaBox,PDFName.CropBox,PDFName.Rotate]) {
        const value = node.getInheritableAttribute(key)
        if (!node.has(key) && value) node.set(key,value)
      }
    }
    for (let i=count-1; i>=0; i--) source.removePage(i)
    for (const recipe of pages) source.addPage(original[recipe.source-1])
  }
  for (const recipe of pages) {
    const page = original[recipe.source-1]
    if (recipe.rotation) page.setRotation(degrees((page.getRotation().angle + recipe.rotation) % 360))
    for (const note of recipe.notes ?? []) {
      if (!Number.isFinite(note.x) || !Number.isFinite(note.y) || typeof note.text !== 'string' || !note.text.trim()) throw new Error('批注数据无效。')
      const { x, y } = note
      const annotation = source.context.obj({
        Type:'Annot', Subtype:'Text', P:page.ref, Name:'Comment', Rect:[x,y-16,x+16,y], C:[1,.78,.2], F:4,
        NM:PDFHexString.fromText(note.id), Contents:PDFHexString.fromText(note.text), T:PDFHexString.fromText('砚页'),
      })
      page.node.addAnnot(source.context.register(annotation))
    }
    for (const mark of recipe.highlights ?? []) {
      if (!Array.isArray(mark.quads) || !mark.quads.length || mark.quads.length>2000 ||
          mark.quads.some(q=>!Array.isArray(q) || q.length!==8 || q.some(v=>!Number.isFinite(v))) ||
          !/^[a-f\d]{6}$/i.test(mark.color)) throw new Error('高亮数据无效。')
      const coords=mark.quads.flat(), xs=coords.filter((_,i)=>i%2===0), ys=coords.filter((_,i)=>i%2===1)
      const color=mark.color.match(/../g).map(part=>parseInt(part,16)/255)
      const annotation=source.context.obj({Type:'Annot',Subtype:'Highlight',P:page.ref, F:4,
        Rect:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)], QuadPoints:coords, C:color,
        NM:PDFHexString.fromText(mark.id),Contents:PDFHexString.fromText(mark.text),T:PDFHexString.fromText('砚页')})
      page.node.addAnnot(source.context.register(annotation))
    }
  }
  return source
}

export async function editedPdfBytes(bytes,pages) {
  const lib=await import('pdf-lib')
  const source=await preparedPdf(bytes,pages,lib)
  return source.save({updateFieldAppearances:false})
}

async function copySelectedPages(source,target,indexes,{PDFDict,PDFName}) {
  const owner=PDFName.of('P')
  // A copied annotation must refer to its visible new page. Detach the old back-reference
  // before copying so the PDF writer does not also serialize a second, unused page.
  for (const index of indexes) {
    for (const ref of source.getPage(index).node.Annots()?.asArray() || []) source.context.lookupMaybe(ref,PDFDict)?.delete(owner)
  }
  for (const page of await target.copyPages(source,indexes)) {
    target.addPage(page)
    for (const ref of page.node.Annots()?.asArray() || []) target.context.lookupMaybe(ref,PDFDict)?.set(owner,page.ref)
  }
}

export async function extractPdfBytes(bytes,pages,range) {
  const lib=await import('pdf-lib')
  const source=await preparedPdf(bytes,pages,lib)
  const indexes=parsePdfPageRange(range,source.getPageCount())
  const output=await lib.PDFDocument.create()
  await copySelectedPages(source,output,indexes,lib)
  return output.save({updateFieldAppearances:false})
}

export async function appendPdfBytes(bytes,pages,extra) {
  const lib=await import('pdf-lib')
  const base=await preparedPdf(bytes,pages,lib)
  const addition=await lib.PDFDocument.load(extra,{updateMetadata:false})
  await copySelectedPages(addition,base,addition.getPageIndices(),lib)
  return base.save({updateFieldAppearances:false})
}
