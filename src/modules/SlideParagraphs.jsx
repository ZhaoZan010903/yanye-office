import React from 'react'
import {pieces,runCss} from './slide-runs.js'

export default function SlideParagraphs({text='',split,runs}) {
  if(!runs?.length && !split)return text
  let offset=0
  return text.split('\n').map((line,index)=>{
    const content=pieces(line,runs,offset).map(({text,style},i)=><span key={i} style={runCss(style)}>{text}</span>)
    offset+=line.length+1
    return split ? <span key={index} data-animation-paragraph={index}>{content}</span> :
      <React.Fragment key={index}>{index>0 && '\n'}{content}</React.Fragment>
  })
}
