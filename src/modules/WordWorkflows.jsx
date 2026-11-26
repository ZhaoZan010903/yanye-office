import React,{useRef,useState} from 'react'
import {compareWord,comparisonReport,comparisonText,reviewCopy,plain} from './word-compare.js'
import {recipientTable,mergeDocuments,mergeField,mergeName} from './word-merge.js'
import {readDocx,writeDocx} from './word-docx.js'

async function base64File(file){
  const {base64}=await import('./plain-text.js')
  return base64(new Uint8Array(await file.arrayBuffer()))
}
export function CompareWordPanel({original,onExport,close}){
  const [result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const seq=useRef(0)
  async function load(file){
    const turn=++seq.current
    setResult(null);setError('')
    if(!file)return
    setBusy(true)
    try{
      const revised=await readDocx(await base64File(file))
      // Normalize the editor's default attributes and Word's unit precision before comparing.
      const baseline=await readDocx(await writeDocx(original))
      const changes=compareWord(baseline,revised)
      const review=changes.length && changes.every(c=>c.kind!=='页面或默认格式')?reviewCopy(baseline,revised):null
      if(turn===seq.current)setResult({changes,review,name:file.name})
    }catch(e){if(turn===seq.current)setError(e.message)}
    finally{if(turn===seq.current)setBusy(false)}
  }
  async function exportDoc(doc,name) {
    setBusy(true);setError('')
    try{await onExport(name,await writeDocx(doc))}catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <section className="word-advanced-panel word-workflow" aria-label="比较文档">
    <label>修订稿<input type="file" accept=".docx" onChange={e=>load(e.target.files[0])}/></label>
    <span>以打开比较时的当前文档为原稿</span><button onClick={close}>关闭比较</button>
    {result&&<><span role="status">{result.name} · {result.changes.length} 处差异</span>
      {result.changes.length>0&&<><button disabled={busy} onClick={()=>exportDoc(comparisonReport(result.changes),'文档比较结果.docx')}>导出对照表</button>
        {result.review && <button disabled={busy} onClick={()=>exportDoc(result.review,'文档比较修订稿.docx')}>导出带修订副本</button>}
        <table aria-label="差异列表"><thead><tr><th>变更</th><th>原稿</th><th>修订稿</th></tr></thead><tbody>{result.changes.slice(0,200).map((c,i)=><tr key={i}><td>{c.kind} {c.position}</td><td>{comparisonText(c.original,c.before)}</td><td>{comparisonText(c.revised,c.after)}</td></tr>)}</tbody></table>
        {result.changes.length>200&&<small>此处显示前 200 处，导出包含所有差异。</small>}</>}</>}
    {busy&&<span role="status">正在处理…</span>}{error&&<span role="alert">{error}</span>}
  </section>
}
export function MergeWordPanel({editor,document,title,onExport,close}){
  const [table,setTable]=useState(null),[column,setColumn]=useState(''),[row,setRow]=useState(0)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState(false)
  const seq=useRef(0)
  async function load(file){
    const turn=++seq.current
    setTable(null);setError('');setPreview(false)
    if(!file)return
    try {
      if(file.size>16*1024*1024)throw Error('请分批加载 16 MiB 以内的数据。')
      const csv=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer())
      const result=recipientTable(csv,/\.tsv$/i.test(file.name)?'\t':',')
      if(turn===seq.current){setTable(result);setColumn(result.columns[0]);setRow(0)}
    }catch(e){if(turn===seq.current)setError(e.message)}
  }
  const fields=[]
  editor.state.doc.descendants(n=>{const name=n.type.name==='wordTextField'&&mergeName(n.attrs.code);if(name)fields.push(name)})
  function insertField(){
    const marks=editor.state.storedMarks??editor.state.selection.$from.marks()
    const formatting=marks.filter(m=>['bold','italic','underline','strike','wordStyle'].includes(m.type.name)).map(m=>m.toJSON())
    editor.chain().focus().insertContent({...mergeField(column),marks:formatting}).run()
  }
  async function output(all){
    setError('');setBusy(true)
    try{
      const data=mergeDocuments(document,table,all?table.rows.map((_,i)=>i):[row])
      await onExport((title||'文档')+'-合并'+(all?'全部':String(row+1))+'.docx',await writeDocx(data))
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  let previewLines=[]
  if(preview && table){
    try{previewLines=mergeDocuments(document,table,[row]).doc.content.map(plain)}
    catch(e){previewLines=[e.message]}
  }
  return <section className="word-advanced-panel word-workflow" aria-label="邮件合并">
    <label>收件人数据<input type="file" accept=".csv,.tsv" onChange={e=>load(e.target.files[0])}/></label>
    {table?<><label>合并域<select value={column} onChange={e=>setColumn(e.target.value)}>{table.columns.map(k=><option key={k}>{k}</option>)}</select></label>
      <button onMouseDown={e=>e.preventDefault()} onClick={insertField}>插入合并域</button>
      <label>记录<select value={row} onChange={e=>setRow(Number(e.target.value))}>{table.rows.map((r,i)=><option key={i} value={i}>{i+1} · {r[0]}</option>)}</select></label>
      <button disabled={!fields.length} aria-pressed={preview} onClick={()=>setPreview(!preview)}>预览结果</button>
      <button disabled={!fields.length||busy} onClick={()=>output(false)}>生成当前记录</button>
      <button disabled={!fields.length||busy} onClick={()=>output(true)}>合并全部记录</button>
      </>:<small>选择 UTF-8 CSV 或 TSV，首行为字段名。</small>}
    <button onClick={close}>关闭邮件合并</button>
    {preview&&<div className="word-merge-preview" aria-label="合并预览">{previewLines.map((s,i)=><p key={i}>{s}</p>)}</div>}{error&&<span role="alert">{error}</span>}
  </section>
}
