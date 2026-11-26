import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Zip from 'jszip'
import { chromium } from 'playwright'
import { build } from 'vite'

const output=await build({configFile:false,logLevel:'error',build:{write:false,
  lib:{entry:'src/modules/slide-animations.js',name:'timing',formats:['iife']}}})
const browser=await chromium.launch({channel:'msedge',headless:true})
try {
  const page=await browser.newPage()
  await page.route('http://localhost/timing',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}))
  await page.goto('http://localhost/timing')
  await page.addScriptTag({content:output[0].output[0].code})
  let nativeSlide=null
  if (process.argv[2]) {
    const file=await Zip.loadAsync(await readFile(process.argv[2]))
    nativeSlide=await file.file('ppt/slides/slide1.xml').async('string')
  }
  const results=await page.evaluate(nativeSlide=>{
    const parse=xml=>new DOMParser().parseFromString(xml,'application/xml')
    const wrap=xml=>parse('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'+xml+'</p:sld>')
    const targets=new Map([['2','title']]),shapeIds=new Map([['title','2']])
    const initial=timing.writeTiming({animations:[{target:'title',effect:'fade',duration:400,trigger:'click'}]},shapeIds)
    const paper={title:'第一段\n第二段',animations:[{target:'title',effect:'fade',duration:400,trigger:'with',delay:150,byParagraph:true}]}
    const shape='<p:sp><p:nvSpPr><p:cNvPr id="2"/></p:nvSpPr><p:txBody><p:p/><p:p/></p:txBody></p:sp>'
    const item=timing.readTiming(wrap(shape+timing.writeTiming(paper,shapeIds)),targets)
    item.title=paper.title+'\n第三段'
    const rewritten=wrap(timing.writeTiming(item,shapeIds))
    const build={editable:item.nativeTiming.editable,byParagraph:item.animations[0].byParagraph,
      triggers:timing.expandedEffects(item).map(e=>[e.trigger,e.delay]),
      ranges:[...rewritten.getElementsByTagNameNS('*','pRg')].map(n=>n.getAttribute('st'))}
    const samples=[
      initial.replace('<p:bldP ','<p:bldP build="p" bldLvl="1" '),
      initial.replace('</p:bldLst>','<p:bldGraphic spid="2" grpId="0"><p:bldAsOne/></p:bldGraphic></p:bldLst>'),
      initial.replace('presetID="10"','afterEffect="1" presetID="10"'),
      initial.replace('presetID="10" presetClass="entr" presetSubtype="0"','presetID="2" presetClass="entr" presetSubtype="5"'),
    ]
    function unchangedBuild(raw) {
      const s=timing.readTiming(wrap(raw),targets)
      const preserved=timing.writeTiming(s,shapeIds)===s.nativeTiming.raw
      s.animations[0].duration=600
      let blocked=false
      try {timing.writeTiming(s,shapeIds)} catch {blocked=true}
      return {editable:s.nativeTiming.editable,preserved,blocked}
    }
    let native
    if (nativeSlide) {
      const doc=parse(nativeSlide)
      const ids=[...doc.getElementsByTagNameNS('*','cNvPr')].map(n=>n.getAttribute('id'))
      const s=timing.readTiming(doc,new Map(ids.map(id=>[id,id])))
      const editable=s.nativeTiming.editable
      s.animations[0].duration=600
      const xml=timing.writeTiming(s,new Map(ids.map(id=>[id,id])))
      native={editable,effects:s.animations.map(e=>e.effect),changed:xml.includes('dur="600"')}
    }
    return {simple:unchangedBuild(initial),complex:samples.map(unchangedBuild),native,build}
  },nativeSlide)
  assert.deepEqual(results.simple,{editable:true,preserved:true,blocked:false})
  assert.deepEqual(results.build,{editable:true,byParagraph:true,triggers:[['with',150],['click',0],['click',0]],ranges:['0','0','1','1','2','2']})
  for (const variant of results.complex) assert.deepEqual(variant,{editable:false,preserved:true,blocked:true})
  if (nativeSlide) assert.deepEqual(results.native,{
    editable:true,effects:['appear','fade','wipe','fly','spin','motion'],changed:true,
  })
  console.log('段落数量联动和首次自动、后续单击的时间线回归通过。复杂构建及斜向运动保持原始 XML。')
  if (nativeSlide) console.log('已验证原生样本中的六种常规动画仍可编辑。')
} finally { await browser.close() }
