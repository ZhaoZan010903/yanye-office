import JSZip from 'jszip'
import { SaxesParser } from 'saxes'
import { parseRange,rangeName } from './spreadsheet.js'
import {addChart,readChart} from './sheet-chart-xml.js'

const spreadsheetNS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relationshipsNS='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const validationAttrs=['type','operator','allowBlank','showDropDown','showInputMessage','showErrorMessage','errorStyle','errorTitle','error','promptTitle','prompt','imeMode']
const escape=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]))

function parse(xml,open,close,text) {
  const parser=new SaxesParser({xmlns:true})
  parser.on('doctype',()=>{throw new Error('工作簿 XML 包含不支持的文档类型。')})
  parser.on('opentag',open)
  if(close) parser.on('closetag',close)
  if(text) {parser.on('text',text);parser.on('cdata',text)}
  parser.write(xml).close()
}

// ExcelJS expands every address in a validation sqref. Keep native rectangles compact,
// including full-column rules produced by Excel and WPS.
export async function nativeRules(bytes, archive) {
  const zip=archive || await JSZip.loadAsync(bytes)
  const xml=async path=>await zip.file(path)?.async('string')??''
  const paths=new Map(), sheets=[]
  parse(await xml('xl/_rels/workbook.xml.rels'),node=>{
    const a=node.attributes
    if(node.local==='Relationship' && a.Type?.value.endsWith('/worksheet') && a.TargetMode?.value!=='External') {
      const path=new URL(a.Target.value,'https://package.invalid/xl/workbook.xml')
      if(path.origin==='https://package.invalid') paths.set(a.Id.value,decodeURIComponent(path.pathname.slice(1)))
    }
  })
  parse(await xml('xl/workbook.xml'),node=>{
    if(node.local==='sheet' && node.uri===spreadsheetNS) {
      const id=Object.values(node.attributes).find(a=>a.uri===relationshipsNS && a.local==='id')?.value
      if(paths.has(id)) sheets.push([node.attributes.name.value,paths.get(id)])
    }
  })
  const result=new Map()
  for (const [name,path] of sheets) {
    const source=await xml(path)
    if (!/(?:dataValidations|autoFilter|drawing)/.test(source)) continue
    const validations=[]
    let autoFilter, filterColumn, rule, formula, withinFilters=false, filterValues,drawing,custom
    parse(source,node=>{
      if(node.uri!==spreadsheetNS) return
      const a=node.attributes
      switch(node.local) {
        case 'drawing': drawing=Object.values(a).find(attr=>attr.uri===relationshipsNS && attr.local==='id')?.value;break
        case 'autoFilter': {
          const box=parseRange(a.ref?.value)
          if(box) autoFilter={box,columns:{}}
          withinFilters=!!box
          break
        }
        case 'filterColumn': if(withinFilters) filterColumn=Number(a.colId?.value); break
        case 'filters': if(withinFilters && Number.isInteger(filterColumn)) {
          filterValues=autoFilter.columns[filterColumn]=[]
          if(['true','1'].includes(a.blank?.value)) filterValues.push('')
        } break
        case 'filter': if(filterValues && a.val) filterValues.push(a.val.value); break
        case 'customFilters': if(withinFilters) custom={values:[],usable:!['1','true'].includes(a.and?.value)};break
        case 'customFilter': if(custom) {
          if((a.operator?.value??'equal')==='equal' && a.val && !/[~*?]/.test(a.val.value)) custom.values.push(a.val.value)
          else custom.usable=false
        } break
        case 'dateGroupItem': if(filterValues) {delete autoFilter.columns[filterColumn];filterValues=undefined} break
        case 'dataValidation':
          rule={refs:(a.sqref?.value??'').trim().split(/\s+/),attrs:Object.fromEntries(validationAttrs.filter(k=>a[k]).map(k=>[k,a[k].value])),formulae:[]}
          break
        case 'formula1': case 'formula2':
          if(rule) {formula=Number(node.local.slice(-1))-1;rule.formulae[formula]=''}
          break
      }
    },node=>{
      if(node.uri!==spreadsheetNS) return
      if(node.local==='autoFilter') withinFilters=false
      if(node.local==='filterColumn') filterColumn=undefined
      if(node.local==='customFilters' && custom) {
        if(custom.usable && custom.values.length && Number.isInteger(filterColumn)) autoFilter.columns[filterColumn]=custom.values
        custom=undefined
      }
      if(node.local==='filters') filterValues=undefined
      if(node.local==='formula1' || node.local==='formula2') formula=undefined
      if(node.local==='dataValidation' && rule) {
        for(const ref of rule.refs) {
          const box=parseRange(ref)
          if(box) validations.push({box,attrs:rule.attrs,formulae:rule.formulae})
        }
        rule=undefined
      }
    },text=>{if(rule && formula!==undefined) rule.formulae[formula]+=text})
    result.set(name,{validations,autoFilter,chart:drawing?await readChart(zip,path,drawing,name):undefined})
  }
  return result
}

export async function writeNativeRules(bytes,sheets,display) {
  if (!sheets.some(s=>s.pivot || s.chart || s.validations?.length || Object.keys(s.autoFilter?.columns??{}).length)) return bytes
  const zip=await JSZip.loadAsync(bytes)
  for (const [index,sheet] of sheets.entries()) {
    const path='xl/worksheets/sheet'+(index+1)+'.xml'
    let xml=await zip.file(path).async('string')
    if (sheet.validations?.length) {
      const parts=sheet.validations.map(({box,attrs,formulae})=>{
        const attributes=validationAttrs.filter(k=>attrs[k]!==undefined).map(k=>' '+k+'="'+escape(attrs[k])+'"').join('')
        const fields=formulae.map((formula,i)=>'<formula'+(i+1)+'>'+escape(formula)+'</formula'+(i+1)+'>').join('')
        return '<dataValidation sqref="'+rangeName(box)+'"'+attributes+'>'+fields+'</dataValidation>'
      }).join('')
      xml=xml.replace(/<dataValidations\b[^>]*>[\s\S]*?<\/dataValidations>/,()=>'<dataValidations count="'+sheet.validations.length+'">'+parts+'</dataValidations>')
    }
    if(Object.keys(sheet.autoFilter?.columns??{}).length) {
      const parts=Object.entries(sheet.autoFilter.columns).map(([index,values])=>'<filterColumn colId="'+Number(index)+'"><filters'+
        (values.includes('')?' blank="1"':'')+'>'+values.filter(v=>v!=='').map(v=>'<filter val="'+escape(v)+'"/>').join('')+'</filters></filterColumn>').join('')
      xml=xml.replace(/<autoFilter\b[^>]*\/>/,()=>'<autoFilter ref="'+rangeName(sheet.autoFilter.box)+'">'+parts+'</autoFilter>')
    }
    zip.file(path,xml)
    if(sheet.chart) await addChart(zip,sheet,index,display)
  }
  if(sheets.some(s=>s.pivot)) {
    const {writePivotParts}=await import('./sheet-pivot-xml.js')
    await writePivotParts(zip,{sheets})
  }
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'})
}
