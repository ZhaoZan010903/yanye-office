import { address, parseRange } from './spreadsheet.js'
import { pivotData, summaries } from './sheet-pivot.js'
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

export async function writePivotParts(zip,book) {
  const targets=book.sheets.filter(s=>s.pivot)
  if(!targets.length) return
  const workbook='xl/workbook.xml', wbRels=relationshipPath(workbook), ct='[Content_Types].xml'
  let relationships=await zip.file(wbRels).async('string'), types=await zip.file(ct).async('string')
  const caches=[]
  for(const [idx,target] of targets.entries()) {
    const n=idx+1, p=target.pivot, data=pivotData(book,p)
    const pivot='pivotTable'+n, cache='pivotCacheDefinition'+n, records='pivotCacheRecords'+n
    const dst='xl/worksheets/sheet'+(book.sheets.indexOf(target)+1)+'.xml'
    const rid='rIdYanYePivot'+n
    const rowValues=data.rows.map(row=>row.label)
    const cacheFields=data.headers.map((name,i)=>{
      const axis=i===p.rowField
      return '<cacheField name="'+esc(name)+'">'+sharedItems(axis?rowValues:data.records.map(r=>r.values[i]),axis)+'</cacheField>'
    }).join('')
    zip.file('xl/pivotCache/'+cache+'.xml',head+'<pivotCacheDefinition xmlns="'+mainNS+'" xmlns:r="'+relNS+'" r:id="rId1" createdVersion="3" refreshedVersion="3" recordCount="'+data.records.length+'"><cacheSource type="worksheet"><worksheetSource ref="'+p.ref+'" sheet="'+esc(data.source.name)+'"/></cacheSource><cacheFields count="'+data.headers.length+'">'+cacheFields+'</cacheFields></pivotCacheDefinition>')
    const rows=data.records.map(r=>'<r>'+r.values.map((v,i)=>i===p.rowField?'<x v="'+r.index+'"/>':cell(v)).join('')+'</r>').join('')
    zip.file('xl/pivotCache/'+records+'.xml',head+'<pivotCacheRecords xmlns="'+mainNS+'" count="'+data.records.length+'">'+rows+'</pivotCacheRecords>')
    zip.file('xl/pivotCache/_rels/'+cache+'.xml.rels',rels(rel('rId1','pivotCacheRecords',records+'.xml')))
    const items=data.rows.map((_,i)=>'<item x="'+i+'"/>').join('')+'<item t="default"/>'
    const fields=data.headers.map((_,i)=>'<pivotField showAll="0"'+(i===p.dataField?' dataField="1"':'')+(i===p.rowField?' axis="axisRow"><items count="'+(rowValues.length+1)+'">'+items+'</items></pivotField>':'/>')).join('')
    const rowItems=data.rows.map((_,i)=>i?'<i><x v="'+i+'"/></i>':'<i><x/></i>').join('')+'<i t="grand"><x/></i>'
    zip.file('xl/pivotTables/'+pivot+'.xml',head+'<pivotTableDefinition xmlns="'+mainNS+'" name="'+esc(p.name)+'" cacheId="'+n+'" dataCaption="值" createdVersion="3" updatedVersion="3" useAutoFormatting="1"><location ref="'+p.reportRange+'" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/><pivotFields count="'+data.headers.length+'">'+fields+'</pivotFields><rowFields count="1"><field x="'+p.rowField+'"/></rowFields><rowItems count="'+(rowValues.length+1)+'">'+rowItems+'</rowItems><colItems count="1"><i/></colItems><dataFields count="1"><dataField name="'+esc(data.caption)+'" fld="'+p.dataField+'" subtotal="'+p.summary+'"/></dataFields><pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showLastColumn="1"/></pivotTableDefinition>')
    zip.file('xl/pivotTables/_rels/'+pivot+'.xml.rels',rels(rel('rId1','pivotCacheDefinition','../pivotCache/'+cache+'.xml')))
    const sr=relationshipPath(dst)
    const destRels=await zip.file(sr)?.async('string') || rels('')
    zip.file(sr,destRels.replace('</Relationships>',rel(rid,'pivotTable','../pivotTables/'+pivot+'.xml')+'</Relationships>'))
    relationships=relationships.replace('</Relationships>',rel(rid,'pivotCacheDefinition','pivotCache/'+cache+'.xml')+'</Relationships>')
    caches.push('<pivotCache cacheId="'+n+'" r:id="'+rid+'"/>')
    const typesToAdd=[[pivot,'pivotTables','pivotTable'],[cache,'pivotCache','pivotCacheDefinition'],[records,'pivotCache','pivotCacheRecords']]
    types=types.replace('</Types>',typesToAdd.map(([name,folder,kind])=>'<Override PartName="/xl/'+folder+'/'+name+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.'+kind+'+xml"/>').join('')+'</Types>')
  }
  const wb=await zip.file(workbook).async('string')
  zip.file(workbook,wb.replace(/<extLst\b|<\/workbook>/,m=>'<pivotCaches>'+caches.join('')+'</pivotCaches>'+m))
  zip.file(wbRels,relationships)
  zip.file(ct,types)
}

export async function readPivotParts(zip,sheets) {
  const paths=Object.keys(zip.files)
  if(!paths.some(p=>p.startsWith('xl/pivotTables/'))) return
  const slicers=paths.some(p=>/^xl\/(?:slicers|slicerCaches|timelines|timelineCaches)\//i.test(p))
  const byName=new Map(sheets.map(s=>[s.name,s]))
  for(const ws of await worksheets(zip)) {
    const target=byName.get(ws.name)
    if(!target) continue
    const entries=(await relations(zip,ws.part)).filter(r=>r.type===relNS+'/pivotTable')
    if(!entries.length) continue
    const p={}, rowFields=[], dataFields=[]
    let section='', unsupported=entries.length!==1 || slicers
    const def=zip.file(entries[0].part)
    if(!def) { target.advancedPivot=true; continue }
    scan(await def.async('string'),node=>{
      if(node.uri!==mainNS) return
      if(node.local==='pivotTableDefinition') {
        p.name=attr(node,'name')
        if(['0','false'].includes(attr(node,'rowGrandTotals'))) unsupported=true
      }
      if(node.local==='location') p.reportRange=attr(node,'ref')
      if(node.local==='rowFields') section='row'
      if(node.local==='field' && section==='row') rowFields.push(Number(attr(node,'x')))
      if(node.local==='dataField') {
        dataFields.push(Number(attr(node,'fld')))
        p.summary=attr(node,'subtotal') || 'sum'; p.caption=attr(node,'name')
        if(attr(node,'showDataAs') && attr(node,'showDataAs')!=='normal') unsupported=true
      }
      if(['colFields','pageFields','filters','formats','conditionalFormats','chartFormats','pivotTableStyle'].includes(node.local) ||
        node.local==='item' && ['1','true'].includes(attr(node,'h'))) unsupported=true
    },node=>{if(node.local==='rowFields') section=''})
    const cache=(await relations(zip,entries[0].part)).find(r=>r.type===relNS+'/pivotCacheDefinition')
    if(cache && zip.file(cache.part)) scan(await zip.file(cache.part).async('string'),node=>{
      if(node.uri===mainNS && node.local==='worksheetSource') {
        p.ref=attr(node,'ref')?.replaceAll('$','').toUpperCase()
        p.sourceId=byName.get(attr(node,'sheet'))?.id
      }
      if(node.local==='fieldGroup' || node.local==='calculatedItems' ||
        node.local==='cacheField' && attr(node,'formula') || node.local==='cacheHierarchy') unsupported=true
    })
    const box=parseRange(p.reportRange), sourceBox=parseRange(p.ref)
    if(!unsupported && p.name && box && sourceBox && p.sourceId && p.sourceId!==target.id &&
      rowFields.length===1 && dataFields.length===1 && [rowFields[0],dataFields[0]].every(i=>Number.isInteger(i)&&i>=0&&i<=sourceBox.right-sourceBox.left) && Object.hasOwn(summaries,p.summary)) {
      p.rowField=rowFields[0]; p.dataField=dataFields[0]
      p.anchor=address(box.top,box.left); target.pivot=p
    } else target.advancedPivot=true
  }
}
