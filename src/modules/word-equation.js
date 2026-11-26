import {elem,first,textOf} from './word-native-object.js'

const functionArgs={frac:['num','den'],sqrt:['e'],root:['deg','e'],sup:['e','sup'],sub:['e','sub'],subsup:['e','sub','sup']}
const xmlNames={frac:'f',sqrt:'rad',root:'rad',sup:'sSup',sub:'sSub',subsup:'sSubSup'}
const run=text=>elem('m:r',{},[elem('m:t',{'xml:space':'preserve'},[text])])

// The input language supports literal Unicode, grouped super/subscripts, and nested fractions/roots.
export function parseEquation(source) {
  if(!source.trim() || source.length>8192)throw Error('请输入 1 至 8192 个字符的公式。')
  let at=0
  function group(depth) {
    if(source[at++]!=='{') throw Error('公式参数需要用花括号括起。')
    const result=sequence(depth+1,true)
    if(source[at++]!=='}')throw Error('公式缺少右花括号。')
    return result
  }
  function sequence(depth,inside) {
    if(depth>32)throw Error('公式嵌套过深。')
    const nodes=[]
    while(at<source.length && source[at]!=='}'){
      const ch=source[at++]
      if(ch==='{' )throw Error('独立的左花括号请写成 \\{。')
      if(ch==='^' || ch==='_'){
        if(!nodes.length)throw Error('上下标需要前面的底数。')
        if(at>=source.length || source[at]==='}')throw Error('上下标缺少内容。')
        let expr
        if(source[at]==='{')expr=group(depth)
        else{
          const symbol=String.fromCodePoint(source.codePointAt(at))
          at+=symbol.length
          expr=[run(symbol)]
        }
        let previous=nodes.pop()
        if(previous.tag==='m:r') {
          const chars=Array.from(textOf(previous)),last=chars.pop()
          if(chars.length)nodes.push(run(chars.join('')))
          previous=run(last)
        }
        const base=elem('m:e',{},[previous]),arg=elem(ch==='^'?'m:sup':'m:sub',{},expr)
        if((ch==='^' && previous.tag==='m:sSub') || (ch==='_' && previous.tag==='m:sSup')){
          const other=previous.children[1]
          nodes.push(elem('m:sSubSup',{},[previous.children[0],ch==='^'?other:arg,ch==='^'?arg:other]))
        }else nodes.push(elem(ch==='^'?'m:sSup':'m:sSub',{},[base,arg]))
      } else if(ch==='\\') {
        if(at<source.length && '\\{}^_'.includes(source[at])) {nodes.push(run(source[at++]));continue}
        const name=/^[a-z]+/i.exec(source.slice(at))?.[0]
        if(!Object.hasOwn(functionArgs,name))throw Error('支持 \\frac、\\sqrt、\\root 和上下标，其他符号可直接输入 Unicode。')
        at+=name.length
        const args=functionArgs[name].map(arg=>elem('m:'+arg,{},group(depth)))
        if(name==='sqrt')args.unshift(elem('m:radPr',{},[elem('m:degHide',{'m:val':'1'})]),elem('m:deg'))
        nodes.push(elem('m:'+xmlNames[name],{},args))
      } else {
        let end=at
        while(end<source.length && !'{}\\_^'.includes(source[end]))end++
        nodes.push(run(ch+source.slice(at,end)));at=end
      }
    }
    if(!inside && at<source.length)throw Error('公式有多余的右花括号。')
    return nodes
  }
  return elem('m:oMath',{},sequence(0,false))
}
const syntaxEscape=text=>text.replace(/[\\{}^_]/g,c=>'\\'+c)
function describe(node,display) {
  const name=node.tag,children=node.children?.filter(c=>typeof c==='object')||[]
  if(name==='m:r')return display?textOf(first(node,'m:t')):children.filter(c=>c.tag==='m:t').map(c=>syntaxEscape(textOf(c))).join('')
  const args=children.filter(c=>!c.tag.endsWith('Pr') && c.tag!=='m:ctrlPr').map(c=>describe(c,display))
  if(args.includes(null))return null
  if(name==='m:f')return display?'('+args[0]+')/('+args[1]+')':'\\frac{'+args[0]+'}{'+args[1]+'}'
  if(name==='m:rad')return display?(args[0]||'')+'√('+args[1]+')':args[0]?'\\root{'+args[0]+'}{'+args[1]+'}':'\\sqrt{'+args[1]+'}'
  if(['m:sSup','m:sSub','m:sSubSup'].includes(name)) {
    const fn={'m:sSup':'sup','m:sSub':'sub','m:sSubSup':'subsup'}[name]
    return display?args.join(' '):'\\'+fn+args.map(a=>'{'+a+'}').join('')
  }
  return ['m:oMath','m:e','m:num','m:den','m:deg','m:sup','m:sub'].includes(name)?args.join(''):null
}
export const equationSource=tree=>describe(tree,false)
export function mathDom(tree) {
  const ns='http://www.w3.org/1998/Math/MathML',tags={'m:oMath':'math','m:f':'mfrac','m:rad':'mroot','m:sSup':'msup','m:sSub':'msub','m:sSubSup':'msubsup','m:r':'mtext'}
  function convert(n) {
    if(n.tag==='m:r')return [ns+' mtext',textOf(n)]
    const kids=(n.children||[]).filter(c=>typeof c==='object' && !c.tag.endsWith('Pr') && c.tag!=='m:ctrlPr')
    if(n.tag==='m:rad')return textOf(first(n,'m:deg'))?[ns+' mroot',convert(kids.at(-1)),convert(kids[0])]:[ns+' msqrt',convert(kids.at(-1))]
    return [ns+' '+(tags[n.tag]||'mrow'),...kids.map(convert)]
  }
  return convert(tree)
}
