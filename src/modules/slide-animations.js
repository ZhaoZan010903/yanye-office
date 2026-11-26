import {SaxesParser} from 'saxes'
import {parseMotion} from './slide-motion.js'

export const animationNames={appear:'出现',fade:'淡入',wipe:'擦除',fly:'飞入',spin:'陀螺旋',motion:'直线路径',path:'自定义路径'}
export const triggerNames={click:'单击时',with:'与上一动画同时',after:'上一动画之后'}
const types={click:'clickEffect',with:'withEffect',after:'afterEffect'}
const presets={appear:1,fade:10,wipe:22,fly:2,spin:8,motion:63,path:63}
const presetClass=key=>['motion','path'].includes(key)?'path':key==='spin'?'emph':'entr'
const directions={down:4,up:1,left:2,right:8}
const children=(root,tag)=>Array.from(root?.getElementsByTagNameNS('*',tag)||[])
const direct=(root,tag)=>Array.from(root?.children||[]).find(el=>el.localName===tag)
const ms=(n,defaultMs)=>Number.isFinite(n)?Math.round(Math.max(0,Math.min(n,86400000))):defaultMs
// Only these timeline elements can be rebuilt by the six editable presets.
// For other timing trees keep the native XML so editing slide text stays safe.
const editableTimingTags=new Set([
  'timing','tnLst','par','cTn','childTnLst','seq','stCondLst','cond','set','cBhvr','tgtEl','spTgt',
  'attrNameLst','attrName','to','strVal','animEffect','anim','tavLst','tav','val','animRot','animMotion',
  'prevCondLst','sldTgt','nextCondLst','bldLst','bldP','txEl','pRg',
])

function canRebuildTimingNode(node) {
  if (!editableTimingTags.has(node.localName)) return false
  if (['repeatCount','repeatDur','autoRev','spd','tmFilter','evtFilter','masterRel','afterEffect']
    .some(key=>node.hasAttribute(key))) return false
  const group=node.getAttribute('grpId')
  if (group!==null && !/^\d+$/.test(group)) return false
  if (node.localName==='bldP') {
    if (node.hasAttribute('build') && !['p','whole'].includes(node.getAttribute('build'))) return false
    if (node.hasAttribute('bldLvl') && node.getAttribute('bldLvl')!=='1') return false
    return Array.from(node.attributes).every(attr=>['spid','grpId','build','bldLvl','animBg'].includes(attr.name) ||
      attr.namespaceURI==='http://www.w3.org/2000/xmlns/')
  }
  if (node.localName==='seq') return direct(node,'cTn')?.getAttribute('nodeType')==='mainSeq'
  if (node.localName==='cond' && node.hasAttribute('evt')) {
    const expected={prevCondLst:'onPrev',nextCondLst:'onNext'}[node.parentElement?.localName]
    return node.getAttribute('evt')===expected
  }
  return true
}

export function effectGroups(effects) {
  const groups=[]
  let group,begin=0
  for (const effect of effects) {
    if (!group || effect.trigger==='click') {
      group={automatic:effect.trigger!=='click',items:[],duration:0}
      groups.push(group); begin=0
    } else if (effect.trigger==='after') begin=group.duration
    const start=begin+ms(effect.delay,0)
    group.items.push({effect,start,begin})
    group.duration=Math.max(group.duration,start+ms(effect.duration,500))
  }
  return groups
}

export function slideTargets(slide) {
  return [
    ['title','标题'],['body','正文'],...(slide.layout==='columns'?[['side','右栏']]:[]),
    ...(slide.layout==='image'&&slide.image?[['image','图片']]:[]),
    ...(slide.shapes||[]).map((s,i)=>[s.id,'形状 '+(i+1)+' '+s.text.slice(0,20)]),
    ...(slide.textBoxes||[]).map((s,i)=>[s.id,'文本框 '+(i+1)+' '+s.text.slice(0,20)]),
  ]
}

export function targetText(slide,target) {
  if (['title','body','side'].includes(target)) return slide[target] || ''
  return [...(slide.textBoxes||[]),...(slide.shapes||[])].find(s=>s.id===target)?.text
}

export function expandedEffects(slide) {
  return (slide.animations||[]).flatMap((effect,group)=>{
    if (!effect.byParagraph) return [{...effect,group}]
    const text=targetText(slide,effect.target)
    if (text===undefined) throw Error('段落动画需要文字对象。')
    return text.split('\n').map((_,paragraph)=>({...effect,group,paragraph,
      trigger:paragraph?'click':effect.trigger,delay:paragraph?(effect.paragraphDelay||0):effect.delay}))
  })
}

export function readTiming(content, targets) {
  const timing=children(content,'timing')[0]
  if (!timing) return {}
  const effects=[], mapped={}, paragraphCounts={}
  const builds=new Map(children(timing,'bldP').map(el=>[el.getAttribute('spid')+'/'+el.getAttribute('grpId'),el]))
  let editable=true
  for(const node of [timing,...timing.getElementsByTagName('*')]) {
    if (node.hasAttribute('spid')) {
      const id=node.getAttribute('spid')
      if(targets.has(id)) mapped[id]=targets.get(id)
      else editable=false
    }
    if (!canRebuildTimingNode(node)) editable=false
  }
  for(const tn of children(timing,'cTn').filter(el=>el.hasAttribute('presetClass'))) {
    const native=Number(tn.getAttribute('presetID')),cl=tn.getAttribute('presetClass')
    let effect=Object.keys(presets).find(key=>presets[key]===native && cl===presetClass(key))
    if (native===0 && cl==='path') effect='path'
    const targetNodes=children(tn,'spTgt'),spid=targetNodes[0]?.getAttribute('spid')
    const target=mapped[spid]
    const trigger=Object.keys(types).find(key=>types[key]===tn.getAttribute('nodeType'))
    if(!effect || !target || !trigger) {editable=false;continue}
    const values=children(tn,'cTn').map(el=>Number(el.getAttribute('dur'))).filter(n=>Number.isFinite(n)&&n>0)
    const duration=ms(Math.max(0,...values),500)
    const delay=ms(Number(direct(direct(tn,'stCondLst'),'cond')?.getAttribute('delay')),0)
    const presetSubtype=Number(tn.getAttribute('presetSubtype'))
    if (['fly','wipe'].includes(effect) && !Object.values(directions).includes(presetSubtype)) editable=false
    const direction=Object.keys(directions).find(key=>directions[key]===presetSubtype) || 'down'
    const degrees=Number(children(tn,'animRot')[0]?.getAttribute('by'))/60000
    const easing={accel:Number(tn.getAttribute('accel'))||0,decel:Number(tn.getAttribute('decel'))||0}
    const motion=children(tn,'animMotion')[0]
    let travel={}
    if (cl==='path') {
      const path=motion?.getAttribute('path'), segments=parseMotion(path)
      if (!segments) {editable=false;continue}
      const pointTypes=motion.getAttribute('ptsTypes')
      if (motion.getAttribute('origin')!=='layout' || ![null,'relative'].includes(motion.getAttribute('pathEditMode')) ||
          Array.from(motion.attributes).some(a=>!['origin','path','pathEditMode','ptsTypes'].includes(a.name)) ||
          (pointTypes && !/^[A-Za-z\s]{1,1024}$/.test(pointTypes))) editable=false
      if (segments.length===2 && segments[1].command==='L' && native===63) {
        travel={dx:segments[1].values[0],dy:segments[1].values[1]}
      } else {effect='path';travel={path,pathPreset:native}}
      if(pointTypes) travel.pointTypes=pointTypes
    }
    const groupKey=spid+'/'+(tn.getAttribute('grpId') || '0')
    const build=builds.get(groupKey)
    const ranges=targetNodes.map(n=>direct(direct(n,'txEl'),'pRg'))
    const first=ranges[0], value=first?.getAttribute('st')
    const item={...easing,...travel,id:crypto.randomUUID(),target,effect,trigger,duration,delay,direction,degrees:degrees||360}
    if (build?.hasAttribute('animBg')) item.animateBackground=build.getAttribute('animBg')
    if (build?.getAttribute('build')==='p' || first) {
      if (!first || !/^\d+$/.test(value) || build?.getAttribute('build')!=='p' ||
          ranges.some(r=>r?.getAttribute('st')!==value || r?.getAttribute('end')!==value) ||
          item.animateBackground==='1' || !['appear','fade','fly','wipe'].includes(effect)) editable=false
      if (first) {item.paragraph=Number(value);item.buildKey=groupKey}
    }
    effects.push(item)
  }
  const grouped=[]
  for(let i=0;i<effects.length;i++) {
    const first=effects[i]
    if (first.paragraph==null) {grouped.push(first);continue}
    const run=[first]
    while(effects[i+1]?.buildKey===first.buildKey) run.push(effects[++i])
    const sp=children(content,'sp').find(s=>children(s,'cNvPr')[0]?.getAttribute('id')===first.buildKey.split('/')[0])
    const count=Array.from(direct(sp,'txBody')?.children || []).filter(el=>el.localName==='p').length
    paragraphCounts[first.target]=count
    const signature=({id,paragraph,buildKey,trigger,delay,...settings})=>JSON.stringify(settings)
    if (count===run.length && !children(sp,'br').length &&
        run.every((item,index)=>item.paragraph===index && signature(item)===signature(first) &&
          (!index || item.trigger==='click' && item.delay===run[1].delay))) {
      const {paragraph,buildKey,...settings}=first
      grouped.push({...settings,byParagraph:true,paragraphDelay:run[1]?.delay || 0})
    } else {editable=false;grouped.push(...run)}
  }
  const raw=new XMLSerializer().serializeToString(timing)
  return {animations:grouped,nativeTiming:{raw,targets:mapped,original:JSON.stringify(grouped),paragraphCounts,editable:editable&&grouped.length>0}}
}

export function writeTiming(slide, shapeIds) {
  const effects=slide.animations||[], native=slide.nativeTiming
  const paragraphCountChanged=Object.entries(native?.paragraphCounts||{}).some(([target,count])=>targetText(slide,target)?.split('\n').length!==count)
  if(native && !paragraphCountChanged && JSON.stringify(effects)===native.original) {
    // Native timing may include relationships to media or executable actions.
    // Never transplant those into an independently rebuilt package.
    const parser=new SaxesParser({xmlns:true})
    let depth=0,root=false
    parser.on('doctype',()=>{throw Error('原始动画时间线包含不支持的类型声明。')})
    parser.on('opentag',el=>{
      if (!depth++) root=el.local==='timing' && el.uri==='http://schemas.openxmlformats.org/presentationml/2006/main'
      if (el.local==='cmd' || Object.values(el.attributes).some(a=>a.uri==='http://schemas.openxmlformats.org/officeDocument/2006/relationships')) {
        throw Error('动画引用了媒体或交互命令，请在原应用中保存该演示。')
      }
    })
    parser.on('closetag',()=>{depth--})
    parser.write(native.raw).close()
    if (!root) throw Error('原始动画时间线无效。')
    return native.raw.replace(/\bspid="(\d+)"/g,(_match,original)=>{
      const id=shapeIds.get(native.targets[original])
      if (id==null) throw Error('动画的目标对象未保留，请在原应用中保存该页。')
      return 'spid="'+id+'"'
    })
  }
  if(native && !native.editable) throw Error('该页含复杂动画，请保留原件或通过原应用修改动画。')
  if(!effects.length) return ''
  let next=2
  const ctn=(attrs,inner='')=>'<p:cTn id="'+(++next)+'" '+attrs+'>'+inner+'</p:cTn>'
  const cond=delay=>'<p:stCondLst><p:cond delay="'+delay+'"/></p:stCondLst>'
  const par=(inner,delay)=>'<p:par>'+ctn('fill="hold"',cond(delay)+'<p:childTnLst>'+inner+'</p:childTnLst>')+'</p:par>'
  function effectTag(item) {
    const {target,effect,trigger}=item, spid=shapeIds.get(target)
    if(!spid || !Object.hasOwn(presets,effect) || !types[trigger]) throw Error('动画参数或目标对象无效。')
    const duration=Math.max(1,ms(item.duration,500)), delay=ms(item.delay,0)
    const ease=['accel','decel'].filter(key=>Number.isFinite(item[key])&&item[key]>0&&item[key]<=100000).map(key=>' '+key+'="'+Math.round(item[key])+'"').join('')
    const direction=Object.hasOwn(directions,item.direction)?item.direction:'down'
    const range=item.paragraph==null?'':'<p:txEl><p:pRg st="'+item.paragraph+'" end="'+item.paragraph+'"/></p:txEl>'
    const tgt='<p:tgtEl><p:spTgt spid="'+spid+'">'+range+'</p:spTgt></p:tgtEl>'
    function behavior(attribute) {
      return '<p:cBhvr>'+ctn('dur="'+duration+'" fill="hold"')+tgt+(attribute?'<p:attrNameLst><p:attrName>'+attribute+'</p:attrName></p:attrNameLst>':'')+'</p:cBhvr>'
    }
    let action=effect==='spin'?'':'<p:set>'+behavior('style.visibility')+'<p:to><p:strVal val="visible"/></p:to></p:set>'
    if(effect==='fade' || effect==='wipe') action+='<p:animEffect transition="in" filter="'+(effect==='fade'?'fade':'wipe('+direction+')')+'">'+behavior()+'</p:animEffect>'
    if(effect==='spin') action='<p:animRot by="'+Math.round((Number.isFinite(item.degrees)?item.degrees:360)*60000)+'">'+behavior('r')+'</p:animRot>'
    if(effect==='fly') {
      const axis=['left','right'].includes(direction)?'x':'y', extent=axis==='x'?'w':'h'
      const origin=(direction==='down'||direction==='right'?'1+#ppt_':'0-#ppt_')+extent+'/2'
      action+='<p:anim calcmode="lin" valueType="num">'+behavior('ppt_'+axis)+'<p:tavLst>'+
        '<p:tav tm="0"><p:val><p:strVal val="'+origin+'"/></p:val></p:tav>'+
        '<p:tav tm="100000"><p:val><p:strVal val="#ppt_'+axis+'"/></p:val></p:tav></p:tavLst></p:anim>'
    }
    if(effect==='motion' || effect==='path') {
      const dx=Number.isFinite(item.dx)?item.dx:0.25, dy=Number.isFinite(item.dy)?item.dy:0
      const behavior='<p:cBhvr>'+ctn('dur="'+duration+'" fill="hold"')+tgt+'<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr>'
      const path=effect==='path'?item.path:'M 0 0 L '+dx+' '+dy+' E'
      if (!parseMotion(path)) throw Error('运动路径指令无效。')
      const points=item.pointTypes && /^[A-Za-z\s]{1,1024}$/.test(item.pointTypes)?' ptsTypes="'+item.pointTypes+'"':''
      action='<p:animMotion origin="layout" path="'+path+'" pathEditMode="relative"'+points+'>'+behavior+'</p:animMotion>'
    }
    const preset=effect==='path' && item.pathPreset===0 ? 0 : presets[effect]
    const attrs='presetID="'+preset+'" presetClass="'+presetClass(effect)+'" presetSubtype="'+(['fly','wipe'].includes(effect)?directions[direction]:0)+'"'+ease+' fill="hold" grpId="'+item.group+'" nodeType="'+types[trigger]+'"'
    return '<p:par>'+ctn(attrs,cond(delay)+'<p:childTnLst>'+action+'</p:childTnLst>')+'</p:par>'
  }
  const sequence=effectGroups(expandedEffects(slide)).map(group=>{
    const starts=new Map()
    for(const {effect,begin} of group.items) starts.set(begin,(starts.get(begin)||'')+effectTag(effect))
    return par([...starts].map(([start,inner])=>par(inner,start)).join(''),group.automatic?0:'indefinite')
  }).join('')
  const event=(tag,evt)=>'<p:'+tag+'><p:cond evt="'+evt+'" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:'+tag+'>'
  const builds=effects.map((item,group)=>'<p:bldP spid="'+shapeIds.get(item.target)+'" grpId="'+group+'"'+
    (item.byParagraph?' build="p"':'')+(['0','1'].includes(item.animateBackground)?' animBg="'+item.animateBackground+'"':'')+'/>').join('')
  return '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'+sequence+'</p:childTnLst></p:cTn>'+event('prevCondLst','onPrev')+event('nextCondLst','onNext')+'</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst>'+builds+'</p:bldLst></p:timing>'
}
