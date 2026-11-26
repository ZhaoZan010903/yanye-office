import { useId } from 'react'
import { FileOutput, FilePlus2, FolderOpen, House, Menu, PanelLeftClose, PanelLeftOpen, Save } from 'lucide-react'
import { IconButton } from '../workspace-ui.jsx'

export default function OfficeFileBar({ disk, busy, navigationOpen, toggleNavigation, home, create, open, save, saveAs }) {
  const menuId = useId()
  const saveLabel = disk ? '保存文件' : '保存草稿'
  const copyLabel = disk ? '另存为' : '导出文件'
  const commands = [
    [FilePlus2, '新建本地文件', 'Ctrl+N', create],
    [FolderOpen, '打开本地文件', 'Ctrl+O', open, busy],
    [Save, saveLabel, 'Ctrl+S', save, busy],
    [FileOutput, copyLabel, 'Ctrl+Shift+S', saveAs, busy],
    [House, '返回文件中心', '', home],
  ]
  return <div className="office-file-bar">
    <button type="button" className="office-file-trigger" popoverTarget={menuId}>
      <Menu size={15} aria-hidden="true"/>文件
    </button>
    <div id={menuId} popover="auto" className="office-file-menu" aria-label="文件操作">
      {commands.map(([Icon, label, shortcut, action, disabled]) =>
        <button type="button" key={label} disabled={disabled} onClick={event => {
          event.currentTarget.closest('[popover]').hidePopover()
          action()
        }}><Icon size={16} aria-hidden="true"/>{label}<kbd>{shortcut}</kbd></button>)}
    </div>
    <IconButton label="返回文件中心" icon={House} onClick={home}/>
    <IconButton label={navigationOpen ? '收起侧栏' : '显示侧栏'} icon={navigationOpen ? PanelLeftClose : PanelLeftOpen}
      onClick={toggleNavigation} aria-expanded={navigationOpen}/>
    <span className="office-command-divider" aria-hidden="true"/>
    <IconButton label={saveLabel} title={saveLabel+' (Ctrl+S)'} icon={Save} onClick={save} disabled={busy}/>
    <IconButton label={copyLabel} title={copyLabel+' (Ctrl+Shift+S)'} icon={FileOutput} onClick={saveAs} disabled={busy}/>
  </div>
}
