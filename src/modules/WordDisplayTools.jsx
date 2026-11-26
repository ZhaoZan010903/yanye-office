import { useEffect, useRef, useState } from 'react'
import { Eye, Fullscreen, NotebookPen, PanelTopOpen } from 'lucide-react'
import { RibbonGroup } from '../office/Ribbon'

export function useWordDisplay(reportError) {
  const root = useRef(null)
  const [writing,setWriting] = useState(false)
  const [full,setFull] = useState(false)
  const [eyeComfort,setEyeComfort] = useState(() => localStorage.getItem('word-eye-comfort') === 'on')
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange',sync)
    return () => document.removeEventListener('fullscreenchange',sync)
  }, [])
  useEffect(() => {
    if (!writing) return
    function escape(event) {
      if (event.key !== 'Escape' || event.isComposing || document.querySelector('dialog[open]')) return
      event.preventDefault()
      setWriting(false)
    }
    window.addEventListener('keydown',escape)
    return () => window.removeEventListener('keydown',escape)
  }, [writing])
  async function toggleFull() {
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen()
      else await root.current.requestFullscreen()
    } catch {
      reportError('当前窗口无法进入全屏。')
    }
  }
  function toggleEye() {
    setEyeComfort(!eyeComfort)
    localStorage.setItem('word-eye-comfort',eyeComfort ? 'off' : 'on')
  }
  return {root,writing,setWriting,full,toggleFull,eyeComfort,toggleEye}
}

export function WordDisplayTools({display, startWriting}) {
  return <RibbonGroup label="工作环境">
    <button type="button" aria-pressed={display.full} onClick={display.toggleFull}><Fullscreen size={15}/>{display.full?'退出全屏':'全屏显示'}</button>
    <button type="button" onClick={startWriting}><NotebookPen size={15}/>写作模式</button>
    <button type="button" aria-pressed={display.eyeComfort} onClick={display.toggleEye}><Eye size={15}/>护眼模式</button>
  </RibbonGroup>
}

export function WritingModeBar({exit}) {
  return <div className="word-writing-bar"><button type="button" onClick={exit} title="Esc">
    <PanelTopOpen size={15}/>退出写作模式 <kbd>Esc</kbd>
  </button></div>
}
