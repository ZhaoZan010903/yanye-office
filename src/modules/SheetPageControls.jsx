import React from 'react'
import { Columns3, FileSpreadsheet, Grid2X2, PanelTop, RectangleHorizontal } from 'lucide-react'
import { RibbonGroup } from '../office/Ribbon'
import { columnName, rangeName } from './spreadsheet.js'
import { marginPreset, marginPresets, paperSizes } from './sheet-page.js'

export default function SheetPageControls({sheet,range,apply}) {
  const page=sheet.pageSetup || {}
  const patch=changes=>apply({...sheet,pageSetup:{...page,...changes}})
  const areas=page.areas || [], paper=page.paperSize
  const margins=marginPreset(page.margins)
  return <>
    <RibbonGroup label="页面设置">
      <label><RectangleHorizontal size={16}/>页边距<select aria-label="页边距" value={margins} onChange={e=>patch({margins:marginPresets[e.target.value]})}>
        {!margins && <option value="">自定义</option>}{Object.keys(marginPresets).map(m=><option key={m}>{m}</option>)}</select></label>
      <label>纸张方向<select aria-label="纸张方向" value={page.orientation || 'portrait'} onChange={e=>patch({orientation:e.target.value})}>
        <option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
      <label>纸张大小<select aria-label="纸张大小" value={paper || ''} onChange={e=>patch({paperSize:Number(e.target.value) || undefined})}>
        <option value="">打印机默认</option>{paper && !paperSizes[paper] && <option value={paper}>原纸型 {paper}</option>}
        {Object.entries(paperSizes).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    </RibbonGroup>
    <RibbonGroup label="打印区域">
      <button className="sheet-action" title={'将 '+rangeName(range)+' 设为当前表的打印区域'} onClick={()=>patch({areas:[range]})}><FileSpreadsheet size={16}/>设置打印区域</button>
      <button className="sheet-action" disabled={!areas.length} onClick={()=>patch({areas:[]})}>清除打印区域</button>
      {areas.length>0 && <output className="sheet-print-refs" title={areas.map(rangeName).join('，')}>{areas.map(rangeName).join('，')}</output>}
    </RibbonGroup>
    <RibbonGroup label="打印标题">
      <button className="sheet-action" title="在每页顶端重复所选行" onClick={()=>patch({printTitlesRow:(range.top+1)+':'+(range.bottom+1)})}>
        <PanelTop size={16}/>{page.printTitlesRow?'顶端标题行 '+page.printTitlesRow:'设置顶端标题行'}</button>
      <button className="sheet-action" title="在每页左侧重复所选列" onClick={()=>patch({printTitlesColumn:columnName(range.left)+':'+columnName(range.right)})}>
        <Columns3 size={16}/>{page.printTitlesColumn?'左端标题列 '+page.printTitlesColumn:'设置左端标题列'}</button>
      <button className="sheet-action" disabled={!page.printTitlesRow && !page.printTitlesColumn} onClick={()=>patch({printTitlesRow:undefined,printTitlesColumn:undefined})}>清除打印标题</button>
    </RibbonGroup>
    <RibbonGroup label="工作表选项">
      <label><input type="checkbox" checked={!!page.showGridLines} onChange={e=>patch({showGridLines:e.target.checked})}/><Grid2X2 size={14}/>打印网格线</label>
      <label><input type="checkbox" checked={!!page.showRowColHeaders} onChange={e=>patch({showRowColHeaders:e.target.checked})}/>打印行号列标</label>
      <label><input type="checkbox" checked={!!page.horizontalCentered} onChange={e=>patch({horizontalCentered:e.target.checked})}/>水平居中打印</label>
    </RibbonGroup>
  </>
}
