import React, { useMemo, useState } from 'react'
import { Dialog } from './workspace-ui.jsx'
import { encodingNames } from './modules/plain-text.js'

function Preview({ request }) {
  const [encoding, setEncoding] = useState('gb18030')
  const preview = useMemo(() => new TextDecoder(encoding).decode(request.bytes.subarray(0, 1024), { stream:true }), [request, encoding])
  return <Dialog title="选择文本编码" onClose={() => request.finish(null)}>
    <p>请确认「{request.name}」的文字显示正确后再打开。</p>
    <label>文件编码 <select value={encoding} onChange={e => setEncoding(e.target.value)}>
      {Object.entries(encodingNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></label>
    <pre className="txt-preview" aria-label="编码预览">{preview}</pre>
    {(encoding === 'gb18030' || encoding === 'gbk') && <p>保存时沿用 {encodingNames[encoding]}。旧系统要求双字节中文时可选择 GBK。</p>}
    <div className="files-dialog-actions"><button className="button" onClick={() => request.finish(null)}>取消</button>
      <button className="button primary" onClick={() => request.finish(encoding)}>按此编码打开</button></div>
  </Dialog>
}

export function TextEncodingDialog({ request }) {
  if (request?.kind==='save-copy') return <Dialog title="无法按当前编码无损保存" onClose={()=>request.finish(false)}>
    <p>{request.reason} 可将当前内容另存为 UTF-8 副本。</p>
    <div className="files-dialog-actions"><button className="button" onClick={()=>request.finish(false)}>返回编辑</button>
      <button className="button primary" onClick={()=>request.finish(true)}>另存 UTF-8 副本</button></div>
  </Dialog>
  return request ? <Preview request={request}/> : null
}
