import React from 'react'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, CaseLower, Copy, Italic, Maximize, Minimize, Strikethrough, Trash2, Underline } from 'lucide-react'
import { RibbonGroup } from '../office/Ribbon'
import { alignToSlide } from './slides-model.js'

const fonts={'Microsoft YaHei':'微软雅黑', SimSun:'宋体', SimHei:'黑体', KaiTi:'楷体', FangSong:'仿宋',
  Aptos:'Aptos', Arial:'Arial', Calibri:'Calibri', Georgia:'Georgia', 'Times New Roman':'Times New Roman'}
const decorations=[['bold','加粗',Bold],['italic','斜体',Italic],['underline','下划线',Underline],['strike','删除线',Strikethrough]]
const alignments=[['left','左对齐',AlignLeft],['center','居中',AlignCenter],['right','右对齐',AlignRight],['justify','两端对齐',AlignJustify]]
const positions={left:'左端对齐',center:'水平居中',right:'右端对齐',top:'顶端对齐',middle:'垂直居中',bottom:'底端对齐'}

export function SlideTextTools({target, format, change}) {
  const displayFonts = {...fonts,[format.fontFace]:fonts[format.fontFace] || format.fontFace}
  return <>
    <RibbonGroup label="字体">
      <div className="slides-tool-stack">
        <div className="slides-tool-row">
          <select aria-label={target+'字体'} title={target+'字体'} value={format.fontFace} onChange={e=>change({fontFace:e.target.value})}>
            {Object.entries(displayFonts).map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select>
          <input aria-label={target+'字号'} title="字号（磅）" className="slides-size-field" type="number" min="6" max="144" step=".5"
            key={target+'-'+format.fontSize} defaultValue={format.fontSize} onKeyDown={e=>{if(e.key==='Enter') e.currentTarget.blur()}}
            onBlur={e=>{if(e.target.checkValidity() && Number.isFinite(e.target.valueAsNumber)) change({fontSize:e.target.valueAsNumber}); else e.target.value=format.fontSize}}/>
        </div>
        <div className="slides-tool-row">
          {decorations.map(([key,label,Icon])=><button key={key} type="button" className="slides-icon" aria-label={label} title={label}
            aria-pressed={!!format[key]} onClick={()=>change({[key]:!format[key]})}><Icon size={15}/></button>)}
          <label className="slides-font-color" title="字体颜色"><CaseLower size={17}/><input type="color" aria-label={target+'字色'}
            value={'#'+format.color} onChange={e=>change({color:e.target.value.slice(1)})}/></label>
        </div>
      </div>
    </RibbonGroup>
    <RibbonGroup label="段落">
      <div className="slides-tool-stack">
        <div className="slides-tool-row">{alignments.map(([value,label,Icon])=><button type="button" className="slides-icon" key={value}
          title={label} aria-label={label} aria-pressed={format.align===value} onClick={()=>change({align:value})}><Icon size={15}/></button>)}</div>
        <label>行距<select value={format.lineSpacing ?? ''} aria-label={target+'行距'} onChange={e=>change({lineSpacing:e.target.value ? Number(e.target.value) : null})}>
          <option value="">默认</option>{[...new Set([1,1.15,1.25,1.5,2,...(format.lineSpacing?[format.lineSpacing]:[])])].sort((a,b)=>a-b)
            .map(value=><option key={value} value={value}>{value} 倍</option>)}</select></label>
      </div>
    </RibbonGroup>
  </>
}

export function SlidePositionTools({object, update, duplicate, remove}) {
  return <RibbonGroup label="排列">
    <div className="slides-tool-stack">
      <select aria-label="对象相对幻灯片对齐" value="" disabled={!object} onChange={e=>update(alignToSlide(object,e.target.value))}>
        <option value="">对齐到幻灯片</option>
        {Object.entries(positions).map(([key,label])=><option key={key} value={key}>{label}</option>)}
      </select>
      <div className="slides-tool-row">
        <button type="button" disabled={!object} onClick={duplicate} title="复制对象" aria-label="复制对象"><Copy size={15}/></button>
        <button type="button" disabled={!object} onClick={remove} title="删除对象" aria-label="删除对象"><Trash2 size={15}/></button>
      </div>
    </div>
  </RibbonGroup>
}

export function SlideZoomTools({zoom,setZoom}) {
  return <RibbonGroup label="显示比例">
    <button aria-label="缩小画布" title="缩小" disabled={zoom<=50} onClick={()=>setZoom(zoom-25)}><Minimize size={16}/></button>
    <button title="适应窗口" aria-label="适应窗口" onClick={()=>setZoom(100)}>{zoom}%</button>
    <button aria-label="放大画布" title="放大" disabled={zoom>=200} onClick={()=>setZoom(zoom+25)}><Maximize size={16}/></button>
  </RibbonGroup>
}
