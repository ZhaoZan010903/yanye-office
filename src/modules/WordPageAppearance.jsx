import { PaintBucket, PanelsTopLeft } from 'lucide-react'
import { RibbonGroup } from '../office/Ribbon'
import { borderPreset, pageBorderStyle, setPageBorder } from './word-page-appearance.js'

export function WordPageAppearance({layout, color, changeLayout, changeColor}) {
  const preset = borderPreset(layout)
  return <RibbonGroup label="页面背景">
    <label><PanelsTopLeft size={15}/>页面边框
      <select aria-label="本节页面边框" value={preset} onChange={e=>changeLayout(setPageBorder(layout,e.target.value))}>
        <option value="none">无边框</option><option value="single">单线</option><option value="double">双线</option>
        <option value="dashed">虚线</option><option value="dotted">点线</option>
        {preset==='custom' && <option value="custom">文档自定义</option>}
      </select>
    </label>
    <label><PaintBucket size={15}/>背景<input type="color" aria-label="页面背景色" value={color || '#ffffff'} onChange={e=>changeColor(e.target.value)}/></label>
    {color && <button type="button" onClick={()=>changeColor(undefined)}>清除背景色</button>}
  </RibbonGroup>
}

export function WordPageFrame({layout}) {
  const style = pageBorderStyle(layout)
  return style && <div aria-hidden="true" className="word-page-frame" style={style}/>
}
