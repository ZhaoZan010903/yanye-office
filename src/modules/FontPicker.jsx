import React, { useId, useState } from 'react'
import { validFont } from './word-model.js'

const fontNames = {
  'Microsoft YaHei':'微软雅黑', SimSun:'宋体', SimHei:'黑体', FangSong:'仿宋', KaiTi:'楷体', DengXian:'等线',
}
const chineseFonts = Object.keys(fontNames)
const westernFonts = ['Aptos','Arial','Calibri','Cambria','Consolas','Georgia','Times New Roman']

export default function FontPicker({ label, value, onChange, useLocalNames=false, defaultLabel }) {
  const [custom, setCustom] = useState(false)
  const [name, setName] = useState('')
  const errorId = useId()
  const fonts = useLocalNames ? chineseFonts.map(f => fontNames[f]) : chineseFonts
  const options = [...new Set([...fonts, ...westernFonts, ...(value ? [value] : [])])]
  function apply() {
    if (!validFont(name.trim())) return
    onChange(name.trim())
    setCustom(false)
  }
  return <>
    <select aria-label={label} value={custom ? '__custom' : value} onChange={e => {
      const next = e.target.value
      setCustom(next === '__custom')
      if (next === '__custom') setName(value)
      else onChange(next)
    }}>
      {defaultLabel && <option value="">{defaultLabel}</option>}
      {options.map(font => <option key={font} value={font}>{fontNames[font] || font}</option>)}
      <option value="__custom">输入字体名称…</option>
    </select>
    {custom && <span className="office-custom-font">
      <input aria-label={label + '名称'} autoFocus maxLength={64} value={name}
        aria-describedby={errorId} onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') { e.preventDefault(); apply() }
          if (e.key === 'Escape') { e.preventDefault(); setCustom(false) }
        }}/>
      <button type="button" disabled={!validFont(name.trim())} onMouseDown={e => e.preventDefault()} onClick={apply}>应用字体</button>
      <button type="button" onClick={() => setCustom(false)}>取消</button>
      <small id={errorId}>使用本机安装的字体名称</small>
    </span>}
  </>
}
