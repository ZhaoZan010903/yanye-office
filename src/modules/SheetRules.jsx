import React from 'react'
import {clearConditions,comparisons,listChoices,makeList,rangeName,replaceValidation,validationAt} from './spreadsheet.js'

export default function SheetRules({mode,sheet,box,apply,close,tryAction}) {
  const current=validationAt(sheet,box.top,box.left)
  return <form className="sheet-rule-panel" aria-label={mode==='list'?'数据验证设置':'条件格式设置'} onSubmit={e=>{
    e.preventDefault()
    const form=new FormData(e.currentTarget)
    tryAction(()=>{
      if(mode==='list') apply(replaceValidation(sheet,box,makeList(box,form.get('choices'))))
      else {
        const priority=Math.max(0,...(sheet.conditions??[]).flatMap(g=>g.rules.map(r=>Number(r.priority)||0)))+1
        const rule={type:'cellIs',operator:form.get('operator'),formulae:[Number(form.get('threshold'))],priority,
          style:{fill:{type:'pattern',pattern:'solid',bgColor:{argb:'FF'+form.get('color').slice(1).toUpperCase()}}}}
        apply({...sheet,conditions:[...(sheet.conditions??[]),{ref:rangeName(box),rules:[rule]}]})
      }
      close()
    })
  }}>
    <strong>{rangeName(box)}</strong>
    {mode==='list'?<label>下拉选项 <input aria-label="下拉选项" name="choices" required autoFocus placeholder="计划，进行中，完成" defaultValue={listChoices(current)?.join('，')??''}/></label>:
      <><label>数值 <select name="operator" aria-label="比较条件">{Object.entries(comparisons).slice(0,6).map(([key,[name]])=><option key={key} value={key}>{name}</option>)}</select></label>
        <input type="number" step="any" name="threshold" aria-label="条件阈值" required defaultValue="0"/>
        <label>填充 <input type="color" name="color" aria-label="满足条件时的填充颜色" defaultValue="#ffdc86"/></label></>}
    <button type="submit">应用到选区</button>
    <button type="button" onClick={()=>{apply(mode==='list'?replaceValidation(sheet,box,null):clearConditions(sheet,box));close()}}>清除选区规则</button>
    <button type="button" onClick={close}>取消</button>
  </form>
}
