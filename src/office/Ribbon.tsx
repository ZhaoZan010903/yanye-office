import React, { useId, useRef } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'
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
  const id = useId()
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const offsets: Record<string, number> = {
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0, End: tabs.length - 1,
    }
    if (!(event.key in offsets)) return
    event.preventDefault()
    const next = offsets[event.key]
    onChange(tabs[next])
    group.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
  return <div className="office-ribbon">
    <div className="ribbon-tabs" ref={group} role="tablist" aria-label={label+'功能区'}>
      {tabs.map((name,index)=><button type="button" key={name} role="tab" id={id+'-'+index}
        aria-selected={active===name} tabIndex={active===name?0:-1}
        onKeyDown={event=>navigate(event,index)} onClick={()=>onChange(name)}>{name}</button>)}
    </div>
    {children && <div className="ribbon-quick">{children}</div>}
  </div>
}
export function RibbonGroup({label,children}:{label:string,children:ReactNode}) {
  return <div className="ribbon-group" role="group" aria-label={label}>
    <div className="ribbon-group-tools">{children}</div><small aria-hidden="true">{label}</small>
  </div>
}
