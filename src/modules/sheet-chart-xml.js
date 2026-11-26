import {SaxesParser} from 'saxes'
import {columnName,location} from './spreadsheet.js'
import {chartData} from './sheet-chart.js'

const chartNS='http://schemas.openxmlformats.org/drawingml/2006/chart'
const drawNS='http://schemas.openxmlformats.org/drawingml/2006/main'
const relNS='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const relRoot='http://schemas.openxmlformats.org/package/2006/relationships'
const sheetDrawNS='http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
const escape=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]))
const types='application/vnd.openxmlformats-officedocument.'
const xmlHead='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function parse(source,open,close,text) {
  const parser=new SaxesParser({xmlns:true})
  parser.on('doctype',()=>{throw new Error('图表 XML 包含不支持的文档类型。')})
  parser.on('opentag',open)
  if(close) parser.on('closetag',close)
  if(text) parser.on('text',text)
  parser.write(source).close()
}

async function target(zip,source,id,type) {
  if(!id) return
  const parts=source.split('/'),name=parts.pop()
  const rels=zip.file([...parts,'_rels',name+'.rels'].join('/'))
  if(!rels) return
  let result
  parse(await rels.async('string'),n=>{
    const a=n.attributes
    if(n.local==='Relationship' && a.Id.value===id && a.Type.value===relNS+'/'+type && a.TargetMode?.value!=='External') {
      const url=new URL(a.Target.value,'https://package.invalid/'+source)
      if(url.origin==='https://package.invalid') result=decodeURIComponent(url.pathname.slice(1))
    }
  })
  return result
}

export async function readChart(zip,sheetPath,id,sheetName) {
  const drawing=await target(zip,sheetPath,id,'drawing')
  if(!drawing || !zip.file(drawing)) return
  let chartId
  parse(await zip.file(drawing).async('string'),n=>{
    if(!chartId && n.local==='chart' && n.uri===chartNS) chartId=Object.values(n.attributes).find(a=>a.uri===relNS && a.local==='id')?.value
  })
  const path=await target(zip,drawing,chartId,'chart')
  if(!path || !zip.file(path)) return
  const data=[],stack=[]
  let cur,field,mode='',grouping='',unsupported=false
  parse(await zip.file(path).async('string'),n=>{
    stack.push(n.local)
    if(n.uri===chartNS && n.local==='barDir') mode=n.attributes.val?.value
    if(n.uri===chartNS && n.local==='grouping') grouping=n.attributes.val?.value
    if(n.uri===chartNS && n.local.endsWith('Chart') && n.local!=='barChart') unsupported=true
    if(n.uri===chartNS && n.local==='ser') {cur={};data.push(cur)}
    if(!cur) return
    if(n.uri===chartNS && n.local==='f') {
      field=['cat','val','tx'].find(k=>stack.includes(k))
      if(field) cur[field]=''
    }
    if(n.uri===drawNS && n.local==='srgbClr' && stack.at(-3)==='spPr' && /^([\da-f]{6})$/i.test(n.attributes.val?.value)) cur.color='#'+n.attributes.val.value
  },n=>{stack.pop();if(n.local==='f')field=undefined;if(n.local==='ser') cur=undefined},v=>{if(cur && field)cur[field]+=v})
  if(unsupported || (grouping && grouping!=='clustered') || !['bar','col'].includes(mode) || !data.length || data.length>6) return
  function source(formula) {
    const match=/^(?:'((?:[^']|'')+)'|([^!]+))!(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?$/i.exec(formula??'')
    if(!match || (match[1]?.replace(/''/g,"'")??match[2]).toLowerCase()!==sheetName.toLowerCase()) return
    const a=location(match[3]),b=location(match[4]??match[3])
    if(a && b && a.col===b.col && b.row>=a.row && b.row-a.row<500 && b.col<128 && b.row<5000) return {col:a.col,start:a.row,end:b.row}
  }
  const label=source(data[0].cat)
  if (!label) return
  const series=[],colors=[]
  for (const item of data) {
    const cat=source(item.cat),val=source(item.val)
    if (!val || !cat || cat.col!==label.col || [cat,val].some(p=>p.start!==label.start || p.end!==label.end)) return
    series.push(val.col);colors.push(item.color??null)
  }
  const title=source(data[0].tx)
  return {col:series[0],series,colors,labelCol:label.col,header:title?.start??Math.max(0,label.start-1),start:label.start,end:label.end,direction:mode}
}

function chartXml(sheet,display) {
  const data=chartData(sheet,display)
  const sheetRef=escape("'"+sheet.name.replace(/'/g,"''")+"'!")
  function source(kind,col,start,end,values) {
    const label=kind==='num'?'num':'str',letter='$'+columnName(col)+'$'
    const ref=sheetRef+letter+(start+1)+(start===end?'':':'+letter+(end+1))
    const cache=values.map((v,i)=>v===null?'':'<c:pt idx="'+i+'"><c:v>'+escape(v)+'</c:v></c:pt>').join('')
    return '<c:'+label+'Ref><c:f>'+ref+'</c:f><c:'+label+'Cache>'+(kind==='num'?'<c:formatCode>General</c:formatCode>':'')+'<c:ptCount val="'+values.length+'"/>'+cache+'</c:'+label+'Cache></c:'+label+'Ref>'
  }
  const series=data.series.map((s,i)=>'<c:ser><c:idx val="'+i+'"/><c:order val="'+i+'"/><c:tx>'+source('str',s.col,data.header,data.header,[s.title])+'</c:tx>'+
    '<c:spPr><a:solidFill><a:srgbClr val="'+s.color.slice(1)+'"/></a:solidFill></c:spPr><c:cat>'+source('str',data.labelCol,data.start,data.end,data.labels)+'</c:cat>'+
    '<c:val>'+source('num',s.col,data.start,data.end,s.values)+'</c:val></c:ser>').join('')
  const direction=sheet.chart.direction==='col'?'col':'bar'
  function axis(kind,id,cross,position) { return '<c:'+kind+'><c:axId val="'+id+'"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="'+position+'"/><c:crossAx val="'+cross+'"/><c:crosses val="autoZero"/></c:'+kind+'>' }
  return xmlHead+'<c:chartSpace xmlns:c="'+chartNS+'" xmlns:a="'+drawNS+'"><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:barChart><c:barDir val="'+direction+'"/><c:grouping val="clustered"/>'+
    series+'<c:axId val="500"/><c:axId val="501"/></c:barChart>'+axis('catAx',500,501,direction==='bar'?'l':'b')+axis('valAx',501,500,direction==='bar'?'b':'l')+'</c:plotArea><c:legend><c:legendPos val="b"/><c:layout/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>'
}

export async function addChart(zip,sheet,index,display) {
  const id=index+1,chart='chartYanye'+id,drawing='drawingYanye'+id
  const sheetFile='xl/worksheets/sheet'+id+'.xml',rels='xl/worksheets/_rels/sheet'+id+'.xml.rels'
  const link=(id,type,path)=>'<Relationship Id="'+id+'" Type="'+relNS+'/'+type+'" Target="'+path+'"/>'
  const empty=xmlHead+'<Relationships xmlns="'+relRoot+'"></Relationships>'
  zip.file(rels,(await zip.file(rels)?.async('string')??empty).replace('</Relationships>',link('rIdYanyeDrawing','drawing','../drawings/'+drawing+'.xml')+'</Relationships>'))
  const source=await zip.file(sheetFile).async('string')
  zip.file(sheetFile,source.replace(/<(?:legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b|<\/worksheet>/,m=>'<drawing r:id="rIdYanyeDrawing"/>'+m))
  zip.file('xl/charts/'+chart+'.xml',chartXml(sheet,display))
  zip.file('xl/drawings/_rels/'+drawing+'.xml.rels',empty.replace('</Relationships>',link('rIdChart','chart','../charts/'+chart+'.xml')+'</Relationships>'))
  const anchor=tag=>'<xdr:'+tag+'><xdr:col>'+(tag==='from'?2:10)+'</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>'+(tag==='from'?1:16)+'</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:'+tag+'>'
  zip.file('xl/drawings/'+drawing+'.xml',xmlHead+'<xdr:wsDr xmlns:xdr="'+sheetDrawNS+'" xmlns:a="'+drawNS+'" xmlns:c="'+chartNS+'" xmlns:r="'+relNS+'"><xdr:twoCellAnchor>'+
    anchor('from')+anchor('to')+'<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="图表 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="'+chartNS+'"><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>')
  const typesFile='[Content_Types].xml'
  zip.file(typesFile,(await zip.file(typesFile).async('string')).replace('</Types>','<Override PartName="/xl/charts/'+chart+'.xml" ContentType="'+types+'drawingml.chart+xml"/><Override PartName="/xl/drawings/'+drawing+'.xml" ContentType="'+types+'drawing+xml"/></Types>'))
}
