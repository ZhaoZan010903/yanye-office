import {A,P,R,child,children,elements,ensured,make,paint} from './slide-native-text.js'
import {nativeRunStyle} from './slide-runs.js'

export const standardMaster=()=>({id:'master',name:'幻灯片母版',background:null,labels:[]})
export function masterFor(deck,slide){return deck.masters?.find(m=>m.id===slide.masterId) || deck.masters?.[0]}
export const solidBackground=root=>child(child(child(child(root,P,'cSld'),P,'bg'),P,'bgPr'),A,'solidFill')?.getElementsByTagNameNS(A,'srgbClr')[0]?.getAttribute('val')
export const shapeId=sp=>elements(sp,P,'cNvPr')[0]?.getAttribute('id')
export function readMaster(root,path,size) {
  const scene=child(root,P,'cSld'),tree=child(scene,P,'spTree')
  const labels=[]
  for(const shape of children(tree,P,'sp')){
    if(elements(shape,P,'ph').length || !child(shape,P,'txBody'))continue
    const xf=child(child(shape,P,'spPr'),A,'xfrm'),off=child(xf,A,'off'),ext=child(xf,A,'ext')
    if(!off || !ext)continue
    const text=elements(shape,A,'p').map(p=>elements(p,A,'t').map(t=>t.textContent).join('')).join('\n')
    if(!text.trim() && !['1','true'].includes(elements(shape,P,'cNvSpPr')[0]?.getAttribute('txBox')))continue
    labels.push({id:shapeId(shape),text,x:Number(off.getAttribute('x'))/size.w,y:Number(off.getAttribute('y'))/size.h,
      w:Number(ext.getAttribute('cx'))/size.w,h:Number(ext.getAttribute('cy'))/size.h,
      fontFace:'Microsoft YaHei',fontSize:18,color:'37352F',...nativeRunStyle(elements(shape,A,'rPr')[0])})
  }
  return {id:path,name:scene?.getAttribute('name') || '幻灯片母版',background:solidBackground(root) || null,labels}
}
export function putBackground(root,color) {
  const scene=child(root,P,'cSld')
  child(scene,P,'bg')?.remove()
  if(!color)return
  const bg=ensured(scene,P,'bg',scene.firstChild)
  const fill=ensured(ensured(bg,P,'bgPr'),A,'solidFill')
  ensured(fill,A,'srgbClr').setAttribute('val',color)
}
function addLabel(tree,id){
  const doc=tree.ownerDocument,sp=make(doc,P,'sp'),nv=ensured(sp,P,'nvSpPr')
  const info=ensured(nv,P,'cNvPr');info.setAttribute('id',id);info.setAttribute('name','母版文本 '+id)
  ensured(nv,P,'cNvSpPr').setAttribute('txBox','1');ensured(nv,P,'nvPr')
  const pr=ensured(sp,P,'spPr');ensured(pr,A,'xfrm')
  const geom=ensured(pr,A,'prstGeom');geom.setAttribute('prst','rect');ensured(geom,A,'avLst');ensured(pr,A,'noFill')
  const tx=ensured(sp,P,'txBody'),body=ensured(tx,A,'bodyPr')
  for(const key of ['lIns','rIns','tIns','bIns'])body.setAttribute(key,'0')
  ensured(tx,A,'lstStyle')
  tree.insertBefore(sp,child(tree,P,'extLst') || null)
  return sp
}
export function applyMaster(root, model, size) {
  const old=readMaster(root,model.id,size)
  if(old.name!==model.name)child(root,P,'cSld').setAttribute('name',model.name)
  if(old.background!==model.background)putBackground(root,model.background)
  const tree=child(child(root,P,'cSld'),P,'spTree')
  const originals=new Map(old.labels.map(label=>[label.id,label]))
  const shapes=new Map(children(tree,P,'sp').map(sp=>[shapeId(sp),sp]))
  const currentIds=new Set(model.labels.map(label=>label.id))
  for(const label of old.labels)if(!currentIds.has(label.id))shapes.get(label.id)?.remove()
  let largest=Math.max(1,...elements(tree,P,'cNvPr').map(el=>Number(el.getAttribute('id')) || 0))
  for(const label of model.labels) {
    const previous=originals.get(label.id)
    if(previous && JSON.stringify(previous)===JSON.stringify(label))continue
    const sp=previous ? shapes.get(label.id) : addLabel(tree,String(++largest))
    const pr=child(sp,P,'spPr'),xf=ensured(pr,A,'xfrm',pr.firstChild)
    if(!previous || ['x','y','w','h'].some(k=>previous[k]!==label[k])){
      const off=ensured(xf,A,'off'),ext=ensured(xf,A,'ext')
      off.setAttribute('x',Math.round(label.x*size.w));off.setAttribute('y',Math.round(label.y*size.h))
      ext.setAttribute('cx',Math.round(label.w*size.w));ext.setAttribute('cy',Math.round(label.h*size.h))
    }
    const tx=child(sp,P,'txBody')
    const changed=Object.fromEntries(['fontFace','fontSize','color'].filter(k=>!previous || previous[k]!==label[k]).map(k=>[k,label[k]]))
    if(!previous || previous.text!==label.text){
      children(tx,A,'p').forEach(p=>p.remove())
      for(const line of label.text.split('\n')){
        const p=make(tx.ownerDocument,A,'p'),r=ensured(p,A,'r'),rp=ensured(r,A,'rPr')
        paint(rp,label);ensured(r,A,'t').textContent=line;paint(ensured(p,A,'endParaRPr'),label);tx.append(p)
      }
    } else if(Object.keys(changed).length){
      for(const r of [...elements(tx,A,'r'),...elements(tx,A,'fld')])paint(ensured(r,A,'rPr',r.firstChild),changed)
      for(const p of children(tx,A,'p'))paint(ensured(p,A,'endParaRPr'),changed)
    }
  }
}
