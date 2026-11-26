import React from 'react'

export default function SlideParagraphs({text='',split}) {
  return split ? text.split('\n').map((paragraph,index)=>
    <span key={index} data-animation-paragraph={index}>{paragraph}</span>) : text
}
