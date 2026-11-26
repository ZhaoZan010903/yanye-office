import { TextEncoder as LegacyEncoder } from '@kayahr/text-encoding/no-encodings'
import '@kayahr/text-encoding/encodings/gbk'
import '@kayahr/text-encoding/encodings/gb18030'
import { encodingNames, restoreLineEndings } from './plain-text.js'

function unencodable(encoding, codePoint) {
  const character=codePoint != null ? ' U+'+codePoint.toString(16).toUpperCase().padStart(4,'0') : ''
  const error=new Error(encodingNames[encoding]+' 无法无损保存字符'+character+'。')
  error.code='TEXT_UNENCODABLE'
  return error
}

export async function legacyBytes(model) {
  const text=restoreLineEndings(model)
  if (!text.isWellFormed()) throw new Error('正文含不成对的 UTF-16 代理项。请修正对应字符，或选择 UTF-16 LE / BE 保存。')
  const encoder=new LegacyEncoder(model.encoding), decoder=new TextDecoder(model.encoding,{fatal:true,ignoreBOM:true})
  const pieces=[]
  let offset=0, size=0, start=performance.now()
  while (offset < text.length) {
    let end=Math.min(text.length,offset+32768)
    if (end<text.length && text.charCodeAt(end)>=0xdc00 && text.charCodeAt(end)<=0xdfff) end--
    const chunk=text.slice(offset,end)
    let bytes
    try { bytes=encoder.encode(chunk) }
    catch (error) {
      const point=/code point (\d+)/i.exec(error.message)?.[1]
      throw unencodable(model.encoding,point==null?null:Number(point))
    }
    const restored=decoder.decode(bytes)
    if (restored!==chunk) {
      let i=0
      while (i<chunk.length && chunk[i]===restored[i]) i++
      throw unencodable(model.encoding,chunk.codePointAt(i))
    }
    pieces.push(bytes)
    size+=bytes.length
    offset=end
    if (performance.now()-start>12 && globalThis.scheduler?.yield) { await scheduler.yield();start=performance.now() }
  }
  const joined=new Uint8Array(size)
  let written=0
  for (const piece of pieces) { joined.set(piece,written);written+=piece.length }
  return joined
}

// Some old files use multiple byte sequences for the same Unicode character.
// Never overwrite these silently with a normalized byte representation.
export async function hasOriginalMapping(model, original) {
  try {
    const canonical=await legacyBytes(model)
    return canonical.length===original.length && canonical.every((value,i)=>original[i]===value)
  } catch (error) {
    if (error.code==='TEXT_UNENCODABLE') return false
    throw error
  }
}
