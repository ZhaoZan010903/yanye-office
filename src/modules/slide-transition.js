export const transitionNames = {none:'无',cut:'切入',fade:'淡化'}
export const speedNames = {fast:'快速',med:'中速',slow:'慢速'}

export function slideTransition(input = {}) {
  return {
    effect:Object.hasOwn(transitionNames,input.effect) ? input.effect : 'none',
    speed:Object.hasOwn(speedNames,input.speed) ? input.speed : 'fast',
    afterMs:Number.isFinite(input.afterMs) ? Math.min(86400000,Math.max(0,Math.round(input.afterMs))) : null,
    click:input.click !== false,
  }
}

export function parseTransition(slide) {
  const ns='http://schemas.openxmlformats.org/presentationml/2006/main'
  const element=slide.getElementsByTagNameNS(ns,'transition')[0]
  if (!element) return null
  const effect=[...element.children].find(child=>child.namespaceURI===ns && Object.hasOwn(transitionNames,child.localName))
  const raw=element.getAttribute('advTm')
  return slideTransition({effect:effect?.localName,speed:element.getAttribute('spd'),
    afterMs:raw && /^\d+$/.test(raw) ? Number(raw) : null,click:!['0','false'].includes(element.getAttribute('advClick'))})
}

export function transitionXml(value) {
  const {effect,speed,afterMs,click}=slideTransition(value)
  if (effect==='none' && afterMs==null && click) return ''
  const timing=afterMs==null ? '' : ' advTm="'+afterMs+'"'
  return '<p:transition spd="'+speed+'" advClick="'+(click?'1':'0')+'"'+timing+'>'+
    (effect==='none' ? '' : '<p:'+effect+'/>')+'</p:transition>'
}
