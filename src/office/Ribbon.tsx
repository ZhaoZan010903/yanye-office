import React, { useContext, useEffect, useId, useRef } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'
import { RibbonDisclosure } from './RibbonDisclosure'
import './ribbon.css'

type RibbonProps = {
  tabs: string[]
  active: string
  onChange: (value: string) => void
  label: string
  children?: ReactNode
}

export default function Ribbon({ tabs, active, onChange, label, children }: RibbonProps) {
  const group = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const disclosure = useContext(RibbonDisclosure)
  const id = useId()
  const enableFocusShortcut = Boolean(disclosure)
  useEffect(() => {
    if (!enableFocusShortcut) return
    function focusRibbon(event: globalThis.KeyboardEvent) {
      if (event.key !== 'F10' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey ||
          event.repeat || event.isComposing || document.querySelector('dialog[open],:popover-open') ||
          !group.current?.getClientRects().length) return
      event.preventDefault()
      if (!group.current.contains(document.activeElement)) previousFocus.current = document.activeElement as HTMLElement
      group.current.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
    }
    window.addEventListener('keydown', focusRibbon)
    return () => window.removeEventListener('keydown', focusRibbon)
  }, [enableFocusShortcut])
  function activate(name: string) {
    if (disclosure?.collapsed) disclosure.setCollapsed(false)
    onChange(name)
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'Escape' && previousFocus.current?.isConnected) {
      event.preventDefault()
      previousFocus.current.focus()
      previousFocus.current = null
      return
    }
    const offsets: Record<string, number> = {
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0, End: tabs.length - 1,
    }
    if (!(event.key in offsets)) return
    event.preventDefault()
    const next = offsets[event.key]
    activate(tabs[next])
    group.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
  return <div className="office-ribbon">
    {disclosure?.fileBar}
    <div className="ribbon-tabs" ref={group} role="tablist" aria-label={label+'功能区'}>
      {tabs.map((name,index)=><button type="button" key={name} role="tab" id={id+'-'+index}
        aria-selected={active===name} tabIndex={active===name?0:-1}
        title={disclosure ? name+'（双击折叠功能区）' : undefined}
        onKeyDown={event=>navigate(event,index)} onClick={()=>activate(name)}
        onDoubleClick={disclosure ? ()=>disclosure.setCollapsed(true) : undefined}>{name}</button>)}
    </div>
    {children && <div className="ribbon-quick">{children}</div>}
  </div>
}
export function RibbonGroup({label,children}:{label:string,children:ReactNode}) {
  return <div className="ribbon-group" role="group" aria-label={label}>
    <div className="ribbon-group-tools">{children}</div><small aria-hidden="true">{label}</small>
  </div>
}
