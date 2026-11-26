import {readSlicers,writeSlicers,x14} from './sheet-slicer-xml.js'
import { address, parseRange } from './spreadsheet.js'
import { pivotData, pivotKey, summaries } from './sheet-pivot.js'
import { attr, escapeXml as esc, head, mainNS, packageNS, relations, relationshipPath, relNS, scan, worksheets } from './workbook-package.js'

const rel = (id,type,target) => '<Relationship Id="'+id+'" Type="'+relNS+'/'+type+'" Target="'+target+'"/>'
const rels = elements => head+'<Relationships xmlns="'+packageNS+'">'+elements+'</Relationships>'
const cell = v => v==='' || v==null ? '<m/>' : typeof v==='number' ? '<n v="'+v+'"/>' : '<s v="'+esc(v)+'"/>'
function sharedItems(values, shared) {
  const strings=values.some(v=>typeof v!=='number' && v!==''), numbers=values.filter(v=>typeof v==='number')
  const blanks=values.includes(''), flags=[]
  if(!strings) flags.push('containsString="0"')
  if(numbers.length) {
    flags.push('containsNumber="1"')
    if(numbers.every(Number.isInteger)) flags.push('containsInteger="1"')
    if(!strings && !blanks) flags.push('containsSemiMixedTypes="0"')
    if(strings) flags.push('containsMixedTypes="1"')
    flags.push('minValue="'+Math.min(...numbers)+'"', 'maxValue="'+Math.max(...numbers)+'"')
  }
  if(blanks) flags.push('containsBlank="1"')
  if(shared) flags.push('count="'+values.length+'"')
  return '<sharedItems '+flags.join(' ')+'>'+(shared?values.map(cell).join(''):'')+'</sharedItems>'
}


function fieldIndices(tag,indices) {
  return '<'+tag+' count="'+indices.length+'">'+indices.map(i=>'<field x="'+i+'"/>').join('')+'</'+tag+'>'
}
function axisItems(tag,items) {
  let previous=[]
  const body=items.map(({path,kind})=>{
    let repeat=0
    while(repeat<path.length-1 && path[repeat]===previous[repeat]) repeat++
    const values=path.length?path.slice(repeat):[0]
    previous=path
    return '<i'+(kind?' t="'+kind+'"':'')+(repeat?' r="'+repeat+'"':'')+'>'+values.map(i=>i?'<x v="'+i+'"/>':'<x/>').join('')+'</i>'
  }).join('')
  return '<'+tag+' count="'+items.length+'">'+body+'</'+tag+'>'
}

export async function writePivotParts(zip,book) {
  const targets=book.sheets.filter(s=>s.pivot)
  if(!targets.length) return
  const workbook='xl/workbook.xml', wbRels=relationshipPath(workbook), ct='[Content_Types].xml'
  let relationships=await zip.file(wbRels).async('string'), types=await zip.file(ct).async('string')
  const caches=[], reports=[]
  for(const [idx,target] of targets.entries()) {
    const n=idx+1, p=target.pivot, data=pivotData(book,p)
    const pivot='pivotTable'+n, cache='pivotCacheDefinition'+n, records='pivotCacheRecords'+n
    const sheetId=book.sheets.indexOf(target)+1, dst='xl/worksheets/sheet'+sheetId+'.xml', rid='rIdYanYePivot'+n
    const slicers=new Map((p.slicers??[]).map(s=>[s.field,s]))
    const cacheFields=data.headers.map((name,i)=>{
      const shared=data.rows.includes(i) || data.col===i || slicers.has(i)
      return '<cacheField name="'+esc(name)+'">'+sharedItems(shared?data.members[i]:data.records.map(r=>r.values[i]),shared)+'</cacheField>'
    }).join('')
    const cacheExt=slicers.size?'<extLst><ext uri="{725AE2AE-9491-48be-B2B4-4EB974FC3084}" xmlns:x14="'+x14+'"><x14:pivotCacheDefinition pivotCacheId="'+n+'"/></ext></extLst>':''
    zip.file('xl/pivotCache/'+cache+'.xml',head+'<pivotCacheDefinition xmlns="'+mainNS+'" xmlns:r="'+relNS+'" r:id="rId1" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="'+data.records.length+'"><cacheSource type="worksheet"><worksheetSource ref="'+p.ref+'" sheet="'+esc(data.source.name)+'"/></cacheSource><cacheFields count="'+data.headers.length+'">'+cacheFields+'</cacheFields>'+cacheExt+'</pivotCacheDefinition>')
    const rows=data.records.map(r=>'<r>'+r.values.map((v,i)=>r.indices[i]==null?cell(v):'<x v="'+r.indices[i]+'"/>').join('')+'</r>').join('')
    zip.file('xl/pivotCache/'+records+'.xml',head+'<pivotCacheRecords xmlns="'+mainNS+'" count="'+data.records.length+'">'+rows+'</pivotCacheRecords>')
    zip.file('xl/pivotCache/_rels/'+cache+'.xml.rels',rels(rel('rId1','pivotCacheRecords',records+'.xml')))
    const fields=data.headers.map((_,i)=>{
      const axis=data.rows.includes(i)?'axisRow':data.col===i?'axisCol':null
      const s=slicers.get(i), selected=s?.selected?new Set(s.selected.map(pivotKey)):null
      let out='<pivotField showAll="0"'+(data.compact?'':' compact="0" outline="0"')+(i===p.dataField?' dataField="1"':'')
      if(axis) out+=' axis="'+axis+'"'
      const subtotal=data.subtotalFields.includes(i)
      if(!subtotal) out+=' defaultSubtotal="0"'
      if (!axis && !s) return out+'/>'
      const items=data.members[i].map((v,j)=>'<item x="'+j+'"'+(selected&&!selected.has(pivotKey(v))?' h="1"':'')+'/>')
      if(subtotal) items.push('<item t="default"/>')
      return out+'><items count="'+items.length+'">'+items.join('')+'</items></pivotField>'
    }).join('')
    const colAxis=data.col==null?'<colItems count="1"><i/></colItems>':fieldIndices('colFields',[data.col])+axisItems('colItems',[...data.colItems.map(j=>({path:[j]})),{kind:'grand',path:[]}])
    zip.file('xl/pivotTables/'+pivot+'.xml',head+'<pivotTableDefinition xmlns="'+mainNS+'" name="'+esc(p.name)+'" cacheId="'+n+'" dataCaption="值" createdVersion="6" updatedVersion="6" minRefreshableVersion="3" '+(data.compact?'outline="1" outlineData="1" compact="1"':'compact="0" compactData="0"')+' useAutoFormatting="1"><location ref="'+p.reportRange+'" firstHeaderRow="1" firstDataRow="'+(data.col==null?1:2)+'" firstDataCol="'+data.rowWidth+'"/><pivotFields count="'+data.headers.length+'">'+fields+'</pivotFields>'+fieldIndices('rowFields',data.rows)+axisItems('rowItems',data.rowItems)+colAxis+'<dataFields count="1"><dataField name="'+esc(data.caption)+'" fld="'+p.dataField+'" subtotal="'+p.summary+'"/></dataFields><pivotTableStyleInfo name="'+esc(p.style||'PivotStyleLight16')+'" showRowHeaders="1" showColHeaders="1" showLastColumn="1"/></pivotTableDefinition>')
    zip.file('xl/pivotTables/_rels/'+pivot+'.xml.rels',rels(rel('rId1','pivotCacheDefinition','../pivotCache/'+cache+'.xml')))
    const sr=relationshipPath(dst)
    const destRels=await zip.file(sr)?.async('string') || rels('')
    zip.file(sr,destRels.replace('</Relationships>',rel(rid,'pivotTable','../pivotTables/'+pivot+'.xml')+'</Relationships>'))
    relationships=relationships.replace('</Relationships>',rel(rid,'pivotCacheDefinition','pivotCache/'+cache+'.xml')+'</Relationships>')
    caches.push('<pivotCache cacheId="'+n+'" r:id="'+rid+'"/>')
    const typesToAdd=[[pivot,'pivotTables','pivotTable'],[cache,'pivotCache','pivotCacheDefinition'],[records,'pivotCache','pivotCacheRecords']]
    types=types.replace('</Types>',typesToAdd.map(([name,folder,kind])=>'<Override PartName="/xl/'+folder+'/'+name+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.'+kind+'+xml"/>').join('')+'</Types>')
    reports.push({n,ws:dst,sheetId,p,data})
  }
  const wb=await zip.file(workbook).async('string')
  zip.file(workbook,wb.replace(/<extLst\b|<\/workbook>/,m=>'<pivotCaches>'+caches.join('')+'</pivotCaches>'+m))
  zip.file(wbRels,relationships)
  zip.file(ct,types)
  await writeSlicers(zip,reports)
}

const off=value=>value==='0'||value==='false'
const on=value=>value==='1'||value==='true'

async function parseReport(zip,part,byName,bindings,target) {
  const p={}, rowFields=[], colFields=[], dataFields=[], subtotal=[], hidden=new Map(), itemOrder=[]
  let section='', field=-1, unsupported=false
  if(!zip.file(part)) return
  scan(await zip.file(part).async('string'),node=>{
    if(node.uri!==mainNS) return
    const key=node.local
    if(key==='pivotTableDefinition') {
      p.name=attr(node,'name')
      p.layout=off(attr(node,'compact'))?'tabular':'compact'
      p.rowCaption=attr(node,'rowHeaderCaption');p.colCaption=attr(node,'colHeaderCaption')
      if(off(attr(node,'rowGrandTotals')) || off(attr(node,'colGrandTotals'))) unsupported=true
    }
    if(key==='pivotField') {
      field++
      itemOrder.push([])
      if(!off(attr(node,'defaultSubtotal'))) subtotal.push(field)
    }
    if(key==='item' && on(attr(node,'h'))) {
      if(!hidden.has(field))hidden.set(field,[])
      hidden.get(field).push(Number(attr(node,'x')))
    }
    if(key==='item' && node.attributes.x) itemOrder[field].push(Number(attr(node,'x')))
    if(key==='location') p.reportRange=attr(node,'ref')
    if(key==='rowFields' || key==='colFields') section=key
    if(key==='field' && section) (section==='rowFields'?rowFields:colFields).push(Number(attr(node,'x')))
    if(key==='dataField') {
      dataFields.push(Number(attr(node,'fld')))
      p.summary=attr(node,'subtotal') || 'sum'; p.caption=attr(node,'name')
      if(attr(node,'showDataAs') && attr(node,'showDataAs')!=='normal') unsupported=true
    }
    if(key==='pivotTableStyleInfo') p.style=attr(node,'name')
    if(['pageFields','filters','formats','conditionalFormats','chartFormats','pivotTableStyle'].includes(key) ||
      (key==='item' && attr(node,'t') && !['default','data'].includes(attr(node,'t'))) || key==='item' && off(attr(node,'sd'))) unsupported=true
  },node=>{if(node.local===section)section=''})
  const cache=(await relations(zip,part)).find(r=>r.type===relNS+'/pivotCacheDefinition')
  if(unsupported || !cache || !zip.file(cache.part)) return
  const names=[], members=[]
  let inShared=false,cacheId
  scan(await zip.file(cache.part).async('string'),node=>{
    if(node.uri===x14 && node.local==='pivotCacheDefinition')cacheId=attr(node,'pivotCacheId')
    if(node.uri!==mainNS) return
    if(node.local==='worksheetSource') {
      p.ref=attr(node,'ref')?.replaceAll('$','').toUpperCase()
      p.sourceId=byName.get(attr(node,'sheet'))?.id
    }
    if(node.local==='cacheField'){names.push(attr(node,'name'));members.push([])}
    if(node.local==='sharedItems') inShared=true
    else if(inShared) {
      const v=attr(node,'v')
      members.at(-1).push(node.local==='n'?Number(v):node.local==='m'?'':node.local==='s'?v:null)
    }
    if(node.local==='fieldGroup' || node.local==='calculatedItems' ||
      node.local==='cacheField' && attr(node,'formula') || node.local==='cacheHierarchy') unsupported=true
  },node=>{if(node.local==='sharedItems')inShared=false})
  const slicers=[]
  for(const sc of bindings.get(p.name)||[]) {
    const {name,caption,cacheName,style,columns,rowHeight,place}=sc
    const field=names.indexOf(sc.field), values=members[field]
    if(!values || sc.sheet!==target.name || sc.cacheId!==cacheId || sc.items.length!==values.length || sc.items.some(i=>values[i.index]==null)) return
    const selected=sc.items.filter(i=>i.selected).map(i=>values[i.index])
    if(!selected.length) return
    slicers.push({field,name,caption,cacheName,style,columns,rowHeight,place,selected:selected.length===values.length?null:selected})
    hidden.delete(field)
  }
  const box=parseRange(p.reportRange), sourceBox=parseRange(p.ref)
  const axes=[...rowFields,...colFields]
  if(unsupported || hidden.size || !p.name || !box || !sourceBox || !p.sourceId || p.sourceId===target.id ||
    !rowFields.length || colFields.length>1 || dataFields.length!==1 || new Set(axes).size!==axes.length ||
    ![...axes,...dataFields].every(i=>Number.isInteger(i)&&i>=0&&i<=sourceBox.right-sourceBox.left) || !Object.hasOwn(summaries,p.summary)) return
  p.order=Object.fromEntries(axes.map(f=>[f,itemOrder[f].map(i=>members[f][i]).filter(v=>v!=null)]))
  return {...p,rowField:rowFields[0],rowFields,columnField:colFields[0]??null,dataField:dataFields[0],
    subtotalFields:rowFields.slice(0,-1).filter(f=>subtotal.includes(f)),slicers,anchor:address(box.top,box.left)}
}

export async function readPivotParts(zip,sheets) {
  if(!Object.keys(zip.files).some(p=>p.startsWith('xl/pivotTables/'))) return
  const bindings=await readSlicers(zip), byName=new Map(sheets.map(s=>[s.name,s]))
  for(const ws of await worksheets(zip)) {
    const target=byName.get(ws.name)
    if(!target)continue
    const entries=(await relations(zip,ws.part)).filter(r=>r.type===relNS+'/pivotTable')
    if(!entries.length)continue
    const pivot=bindings && entries.length===1 && await parseReport(zip,entries[0].part,byName,bindings,target)
    if(pivot) target.pivot=pivot
    else target.advancedPivot=true
  }
  if(bindings && [...bindings.keys()].some(name=>!sheets.some(s=>s.pivot?.name===name))) sheets[0].advancedPivot=true
}
