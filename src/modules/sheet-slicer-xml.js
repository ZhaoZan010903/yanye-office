import {escapeXml as esc, head, mainNS, packageNS, relNS, relId, relations, relationshipPath, scan, attr, worksheets} from './workbook-package.js'
import {pivotKey} from './sheet-pivot.js'

export const x14='http://schemas.microsoft.com/office/spreadsheetml/2009/9/main'
const msrel='http://schemas.microsoft.com/office/2007/relationships/'
const draw='http://schemas.openxmlformats.org/drawingml/2006'
const xs=draw+'/spreadsheetDrawing', graphic=draw+'/main', shape='http://schemas.microsoft.com/office/drawing/2010/slicer'
const cachesExtension='{BBE1A952-AA13-448e-AADC-164F8A28A991}', sheetExtension='{A8765BA9-456A-4dab-B4F3-ACF838C121DE}'
const addExtension=(xml,tag,uri,body)=>{
  const ext='<ext uri="'+uri+'" xmlns:x14="'+x14+'">'+body+'</ext>'
  return xml.includes('</extLst>')?xml.replace('</extLst>',ext+'</extLst>'):xml.replace('</'+tag+'>','<extLst>'+ext+'</extLst></'+tag+'>')
}
async function append(zip,path,end,value,empty) {
  const original=await zip.file(path)?.async('string')??empty
  zip.file(path,original.replace(end,value+end))
}
const emptyRels=head+'<Relationships xmlns="'+packageNS+'"></Relationships>'
function link(zip,path,id,type,to) {
  return append(zip,relationshipPath(path),'</Relationships>','<Relationship Id="'+id+'" Type="'+type+'" Target="'+to+'"/>',emptyRels)
}
function override(zip,path,type) {return append(zip,'[Content_Types].xml','</Types>','<Override PartName="/'+path+'" ContentType="'+type+'"/>')}

function anchor(name,id,place) {
  function pos(tag,p) {
    return '<xdr:'+tag+'>'+['col','colOff','row','rowOff'].map((key,i)=>'<xdr:'+key+'>'+p[i]+'</xdr:'+key+'>').join('')+'</xdr:'+tag+'>'
  }
  const n=esc(name)
  return '<xdr:twoCellAnchor editAs="oneCell">'+pos('from',place.from)+pos('to',place.to)+
    '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14"><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="'+id+'" name="'+n+'"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="'+shape+'"><sle:slicer xmlns:sle="'+shape+'" name="'+n+'"/></a:graphicData></a:graphic></xdr:graphicFrame></mc:Choice><mc:Fallback><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:sp></mc:Fallback></mc:AlternateContent><xdr:clientData/></xdr:twoCellAnchor>'
}

export async function writeSlicers(zip, reports) {
  const wb='xl/workbook.xml', cacheRefs=[], names=[], used=new Set()
  function unique(base){let name=base,i=1;while(used.has(name.toLowerCase())) name=base+'_'+(++i);used.add(name.toLowerCase());return name}
  for(const {n,p,ws,sheetId,data} of reports) {
    const all=p.slicers??[]
    if(!all.length) continue
    const slicers=[], shapes=[]
    for(const [i,s] of all.entries()) {
      const key=n+'_'+(i+1), field=data.headers[s.field], cache=unique(s.cacheName||'Slicer_'+key)
      const name=unique(s.name||'Filter_'+key), caption=s.caption??field
      const rid='rIdYanYeSC'+key, path='xl/slicerCaches/slicerCache'+key+'.xml'
      cacheRefs.push('<x14:slicerCache r:id="'+rid+'"/>')
      names.push('<definedName name="'+esc(cache)+'">#N/A</definedName>')
      const selected=s.selected?new Set(s.selected.map(pivotKey)):null
      const items=data.members[s.field].map((v,j)=>'<i x="'+j+'"'+(!selected||selected.has(pivotKey(v))?' s="1"':'')+'/>')
      zip.file(path,head+'<slicerCacheDefinition xmlns="'+x14+'" name="'+esc(cache)+'" sourceName="'+esc(field)+'"><pivotTables><pivotTable tabId="'+sheetId+'" name="'+esc(p.name)+'"/></pivotTables><data><tabular pivotCacheId="'+n+'"><items count="'+items.length+'">'+items.join('')+'</items></tabular></data></slicerCacheDefinition>')
      await link(zip,wb,rid,msrel+'slicerCache','slicerCaches/slicerCache'+key+'.xml')
      await override(zip,path,'application/vnd.ms-excel.slicerCache+xml')
      slicers.push('<slicer name="'+esc(name)+'" cache="'+esc(cache)+'" caption="'+esc(caption)+'" rowHeight="'+(s.rowHeight??209550)+'"'+(s.style?' style="'+esc(s.style)+'"':'')+' columnCount="'+(s.columns??1)+'"/>')
      const left=Math.min(15000,data.rows.length+data.colItems.length+3+i*3)
      shapes.push(anchor(name,1000+i,s.place??{from:[left,0,0,0],to:[left+3,0,9,0]}))
    }
    const part='xl/slicers/slicer'+n+'.xml'
    zip.file(part,head+'<slicers xmlns="'+x14+'">'+slicers.join('')+'</slicers>')
    await override(zip,part,'application/vnd.ms-excel.slicer+xml')
    await link(zip,ws,'rIdYanYeSlicerList',msrel+'slicer','../slicers/slicer'+n+'.xml')
    let worksheet=await zip.file(ws).async('string')
    const drawing=(await relations(zip,ws)).find(rel=>rel.type===relNS+'/drawing')
    if(drawing) await append(zip,drawing.part,'</xdr:wsDr>',shapes.join(''))
    else {
      const path='xl/drawings/drawingPivot'+n+'.xml'
      zip.file(path,head+'<xdr:wsDr xmlns:xdr="'+xs+'" xmlns:a="'+graphic+'">'+shapes.join('')+'</xdr:wsDr>')
      await override(zip,path,'application/vnd.openxmlformats-officedocument.drawing+xml')
      await link(zip,ws,'rIdYanYeSlicerDrawing',relNS+'/drawing','../drawings/drawingPivot'+n+'.xml')
      worksheet=worksheet.replace(/<(?:legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b|<\/worksheet>/,m=>'<drawing r:id="rIdYanYeSlicerDrawing"/>'+m)
    }
    zip.file(ws,addExtension(worksheet,'worksheet',sheetExtension,'<x14:slicerList><x14:slicer r:id="rIdYanYeSlicerList"/></x14:slicerList>'))
  }
  if(!names.length) return
  let xml=await zip.file(wb).async('string')
  if(xml.includes('</definedNames>')) xml=xml.replace('</definedNames>',names.join('')+'</definedNames>')
  else xml=xml.replace(/<calcPr\b|<pivotCaches\b|<\/workbook>/,m=>'<definedNames>'+names.join('')+'</definedNames>'+m)
  zip.file(wb,addExtension(xml,'workbook',cachesExtension,'<x14:slicerCaches>'+cacheRefs.join('')+'</x14:slicerCaches>'))
}

// Only accept caches with one connected report and a normal drawing on its own
// worksheet. Unhandled timelines and shared connections retain the entire original.
export async function readSlicers(zip) {
  const parts=Object.keys(zip.files).filter(p=>/^xl\/(?:slicers|slicerCaches)\/[^/]+\.xml$/i.test(p))
  const handled=new Set(), caches=new Map(), result=new Map()
  if(Object.keys(zip.files).some(p=>/^xl\/(?:timelines|timelineCaches)\//i.test(p))) return null
  if(!parts.length) return result
  for(const rel of await relations(zip,'xl/workbook.xml')) if(rel.type===msrel+'slicerCache') {
    const cache={items:[],reports:[]}
    const file=zip.file(rel.part)
    if(!file) return null
    scan(await file.async('string'),n=>{
      if(n.uri!==x14) return
      if(n.local==='slicerCacheDefinition'){cache.cacheName=attr(n,'name');cache.field=attr(n,'sourceName')}
      if(n.local==='pivotTable') cache.reports.push(attr(n,'name'))
      if(n.local==='tabular') cache.cacheId=attr(n,'pivotCacheId')
      if(n.local==='i') cache.items.push({index:Number(attr(n,'x')),selected:['1','true'].includes(attr(n,'s'))})
    })
    if(!cache.cacheName || !cache.field || !cache.cacheId || cache.reports.length!==1 || caches.has(cache.cacheName)) return null
    caches.set(cache.cacheName,cache); handled.add(rel.part)
  }
  for(const ws of await worksheets(zip)) {
    const related=await relations(zip,ws.part)
    const definitions=related.filter(r=>r.type===msrel+'slicer')
    if(!definitions.length) continue
    const drawing=related.find(r=>r.type===relNS+'/drawing')
    if(!drawing || !zip.file(drawing.part) || definitions.length!==1) return null
    const places=new Map()
    let place, side, metric, active
    scan(await zip.file(drawing.part).async('string'),n=>{
      if(n.uri===xs && n.local==='twoCellAnchor') place={}
      if(!place) return
      if(n.uri===xs && ['from','to'].includes(n.local)){side=n.local;place[side]=[0,0,0,0]}
      if(side && n.uri===xs) metric=['col','colOff','row','rowOff'].indexOf(n.local)
      if(n.uri===shape && n.local==='slicer') active=attr(n,'name')
    },n=>{
      if(n.uri!==xs)return
      if(['from','to'].includes(n.local))side=null
      metric=-1
      if(n.local==='twoCellAnchor'){if(active && place?.from && place.to) places.set(active,place);place=active=null}
    },text=>{if(side && metric>=0)place[side][metric]=Number(text)})
    const part=definitions[0].part
    if(!zip.file(part)) return null
    let supported=true
    scan(await zip.file(part).async('string'),n=>{
      if(n.uri!==x14 || n.local!=='slicer') return
      const c=caches.get(attr(n,'cache')), name=attr(n,'name')
      if(!c || c.bound || !places.has(name)){supported=false;return}
      c.bound=true
      const report=c.reports[0]
      const list=result.get(report)||[]
      list.push({...c, name,caption:attr(n,'caption'),rowHeight:Number(attr(n,'rowHeight'))||209550,
        columns:Number(attr(n,'columnCount'))||1,style:attr(n,'style'),place:places.get(name), sheet:ws.name})
      result.set(report,list)
    })
    if(!supported) return null
    handled.add(part)
  }
  return parts.every(p=>handled.has(p)) && [...caches.values()].every(c=>c.bound) ? result : null
}
