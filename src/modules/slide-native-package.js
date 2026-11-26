import {A,P,R,child,children,elements,patchTextBody} from './slide-native-text.js'
import {characterKeys,nativeTextRuns} from './slide-runs.js'
import {applyMaster,masterFor,putBackground,shapeId} from './slide-masters.js'
import {fieldFormat,slideThemes} from './slides-model.js'

const serializer=()=>new XMLSerializer()
export const relPath=p=>p.replace(/([^/]+)$/,'_rels/$1.rels')
const resolvePart=(part,target)=>decodeURIComponent(new URL(target,'https://package.invalid/'+part).pathname.slice(1))
function relative(from,to) {
  const left=from.split('/').slice(0,-1),right=to.split('/')
  while(left.length && left[0]===right[0]){left.shift();right.shift()}
  return '../'.repeat(left.length)+right.join('/')
}
async function xml(zip,path) {
  const entry=zip.file(path)
  if(!entry)throw Error('母版所需的原始部件缺失：'+path)
  const doc=new DOMParser().parseFromString(await entry.async('string'),'application/xml')
  if(doc.getElementsByTagName('parsererror').length)throw Error('无法读取母版相关 XML。')
  return doc
}
const relationships=doc=>elements(doc,'*','Relationship')
const omit=(object,keys)=>Object.fromEntries(Object.entries(object).filter(([key])=>!keys.includes(key)))
async function digest(data){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)))
  return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('')
}
function structural(slide){
  const skip=['text','runs','align','lineSpacing','shapeTextAlign',...characterKeys]
  return {...omit(slide,['native','fieldRuns','fieldFormats','title','body','side','textBoxes','shapes','inheritBackground']),
    textBoxes:slide.textBoxes?.map(box=>omit(box,skip)),shapes:slide.shapes?.map(box=>omit(box,skip))}
}
export function targetValue(slide,key,theme) {
  if(['title','body','side'].includes(key))return {text:slide[key] || '',runs:slide.fieldRuns?.[key] || [],format:fieldFormat(slide,key,theme)}
  const obj=slide.textBoxes?.find(o=>o.id===key) || slide.shapes?.find(o=>o.id===key)
  if(!obj)return null
  return {text:obj.text,runs:obj.runs || [],format:{...Object.fromEntries(characterKeys.map(k=>[k,obj[k]])),
    align:obj.shapeTextAlign || obj.align,lineSpacing:obj.lineSpacing}}
}
export async function recordNative(slide,path,layout,targets,theme) {
  const data={}
  for(const [id,key] of targets){
    const val=targetValue(slide,key,theme)
    if(val)data[key]={id,format:val.format,digest:await digest(val)}
  }
  const unmapped=Object.fromEntries(['title','body','side'].filter(key=>!data[key]).map(k=>[k,slide[k] || '']))
  slide.native={path,layout,signature:await digest(structural(slide)),targets:data,unmapped}
}
export async function nativeEdit(deck,source) {
  if(deck.native.theme!==deck.theme || deck.slides.length!==deck.native.order.length)return
  for(const [i,slide] of deck.slides.entries()) {
    if(!slide.native || slide.native.path!==deck.native.order[i] || await digest(structural(slide))!==slide.native.signature)return
    for(const [key,text] of Object.entries(slide.native.unmapped || {}))if((slide[key] || '')!==text)return
  }
  for(const master of deck.masters || []) {
    if(!master.edited)continue
    const doc=await xml(source,master.id)
    applyMaster(doc.documentElement,master,deck.native.size)
    source.file(master.id,serializer().serializeToString(doc))
  }
  for(const slide of deck.slides){
    const changed=[]
    for(const [key,old] of Object.entries(slide.native.targets)){
      const val=targetValue(slide,key,slideThemes[deck.theme] || slideThemes.paper)
      if(await digest(val)!==old.digest)changed.push({old,val})
    }
    if(!changed.length && !slide.inheritBackground)continue
    const doc=await xml(source,slide.native.path)
    if(slide.inheritBackground)putBackground(doc.documentElement,null)
    const shapes=new Map(elements(doc,P,'sp').map(sp=>[shapeId(sp),sp]))
    for(const {old,val} of changed){
      const sp=shapes.get(old.id)
      if(!sp)throw Error('原始页中找不到所选文本对象。')
      patchTextBody(sp,{format:old.format,runs:nativeTextRuns(sp)},val)
    }
    source.file(slide.native.path,serializer().serializeToString(doc))
  }
  return source.generateAsync({type:'base64',compression:'DEFLATE'})
}

// A structural edit rebuilds the slide drawing. Retain each master, layout,
// theme and its related media as a connected part graph in the new package.
export async function attachMasters(pack,source,deck,size) {
  const models=deck.masters || []
  if(!models.length)return
  if(!source){
    const path='ppt/slideMasters/slideMaster1.xml',doc=await xml(pack,path)
    applyMaster(doc.documentElement,models[0],size)
    pack.file(path,serializer().serializeToString(doc))
    return
  }
  const pres='ppt/presentation.xml',types='[Content_Types].xml'
  const presentation=await xml(pack,pres),rels=await xml(pack,relPath(pres)),ct=await xml(pack,types),oldCt=await xml(source,types)
  const roots=elements(presentation,P,'sldMasterIdLst')[0]
  const masterRefs=relationships(rels).filter(rel=>rel.getAttribute('Type').endsWith('/slideMaster'))
  const mapped=new Map(),queue=models.map(m=>m.id),used=new Set(Object.keys(pack.files))
  const oldTypes=new Map(elements(oldCt,'*','Override').map(n=>[n.getAttribute('PartName').slice(1),n.getAttribute('ContentType')]))
  const defaults=new Map(elements(oldCt,'*','Default').map(n=>[n.getAttribute('Extension').toLowerCase(),n.getAttribute('ContentType')]))
  while(queue.length){
    const path=queue.shift()
    if(mapped.has(path))continue
    if(!source.file(path))throw Error('母版资源缺失：'+path)
    let dest=path,n=2
    while(used.has(dest))dest=path.replace(/(?:\d+)?(\.[^./]+)$/,(m,ext)=>String(n++)+ext)
    used.add(dest);mapped.set(path,dest)
    if(source.file(relPath(path)))for(const r of relationships(await xml(source,relPath(path)))){
      if(r.getAttribute('TargetMode')!=='External')queue.push(resolvePart(path,r.getAttribute('Target')))
    }
  }
  for(const [path,dest] of mapped) {
    const model=models.find(m=>m.id===path)
    if(model?.edited){const d=await xml(source,path);applyMaster(d.documentElement,model,deck.native.size);pack.file(dest,serializer().serializeToString(d))}
    else pack.file(dest,await source.file(path).async('uint8array'))
    if(source.file(relPath(path))){
      const d=await xml(source,relPath(path))
      for(const r of relationships(d))if(r.getAttribute('TargetMode')!=='External')r.setAttribute('Target',relative(dest,mapped.get(resolvePart(path,r.getAttribute('Target')))))
      pack.file(relPath(dest),serializer().serializeToString(d))
    }
    const type=oldTypes.get(path) || defaults.get(path.split('.').pop().toLowerCase())
    if(type){const o=ct.createElementNS(ct.documentElement.namespaceURI,'Override');o.setAttribute('PartName','/'+dest);o.setAttribute('ContentType',type);ct.documentElement.append(o)}
  }
  Array.from(roots.children).forEach(n=>n.remove());masterRefs.forEach(n=>n.remove())
  for(const [i,master] of models.entries()){
    const id='rYanYeMaster'+i,tag=presentation.createElementNS(P,'p:sldMasterId')
    tag.setAttribute('id',String(2147483648+i*100));tag.setAttributeNS(R,'r:id',id);roots.append(tag)
    const rel=rels.createElementNS(rels.documentElement.namespaceURI,'Relationship')
    rel.setAttribute('Id',id);rel.setAttribute('Type',R+'/slideMaster');rel.setAttribute('Target',relative(pres,mapped.get(master.id)));rels.documentElement.append(rel)
  }
  for(const [i,slide] of deck.slides.entries()){
    const path='ppt/slides/slide'+(i+1)+'.xml',rs=await xml(pack,relPath(path))
    const master=masterFor(deck,slide),layout=slide.native?.layout || slide.layoutPart || master.layouts?.[0]
    if(!mapped.has(layout))throw Error('未找到该页对应的母版版式。')
    relationships(rs).find(r=>r.getAttribute('Type').endsWith('/slideLayout')).setAttribute('Target',relative(path,mapped.get(layout)))
    pack.file(relPath(path),serializer().serializeToString(rs))
  }
  for(const [p,d] of [[pres,presentation],[relPath(pres),rels],[types,ct]])pack.file(p,serializer().serializeToString(d))
}
