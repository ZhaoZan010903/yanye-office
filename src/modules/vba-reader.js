import { read } from 'cfb'

const invalid=()=>{throw Error('VBA 项目中的只读源码结构无效。')}
const sourceLimit=2*1024*1024
const view=bytes=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)

// MS-OVBA 2.4.1. Reject references outside their 4 KiB chunk and cap output
// before allocating for untrusted compressed input.
export function decompressVba(bytes,limit=sourceLimit) {
  if(bytes[0]!==1) invalid()
  const chunks=[], reader=view(bytes)
  let at=1,written=0
  while(at<bytes.length) {
    if(at+2>bytes.length) invalid()
    const h=reader.getUint16(at,true),end=at+(h&0xfff)+3
    if(((h>>>12)&7)!==3 || end>bytes.length) invalid()
    at+=2
    if(!(h&0x8000)) {
      if(end-at!==4096 || written+4096>limit) invalid()
      chunks.push(bytes.subarray(at,end));written+=4096;at=end
      continue
    }
    const part=new Uint8Array(Math.min(4096,limit-written))
    let used=0
    while(at<end) {
      const flags=bytes[at++]
      for(let bit=0;bit<8 && at<end;bit++) {
        if(!(flags&(1<<bit))) {
          if(used>=part.length) invalid()
          part[used++]=bytes[at++]
          continue
        }
        if(at+2>end || used===0) invalid()
        const token=reader.getUint16(at,true);at+=2
        const highBits=Math.max(4,Math.ceil(Math.log2(used))),lowBits=16-highBits
        const offset=(token>>>lowBits)+1,length=(token&((1<<lowBits)-1))+3
        if(offset>used || used+length>part.length) invalid()
        for(let j=0;j<length;j++,used++) part[used]=part[used-offset]
      }
    }
    chunks.push(part.subarray(0,used));written+=used
  }
  const result=new Uint8Array(written)
  let pos=0
  for(const chunk of chunks) {result.set(chunk,pos);pos+=chunk.length}
  return result
}

// Only recognize the documented, unlocked public values. A password record
// whose size differs from the empty sentinel is rejected before its contents
// are inspected. Missing or ambiguous settings never grant source access.
function hasPublicSetting(manifest,key,expected) {
  const matches=manifest.split(/\r?\n/).filter(line=>line.startsWith(key+'='))
  if(matches.length!==1) return false
  const match=/^[A-Z]+="([0-9a-f]+)"$/i.exec(matches[0])
  if(!match || match[1].length%2 || match[1].length>28) return false
  const bytes=Uint8Array.from(match[1].match(/../g),v=>parseInt(v,16)),seed=bytes[0]
  const ignore=(seed&6)>>>1
  if((seed^bytes[1])!==2 || bytes.length!==3+ignore+4+expected.length) return false
  let previous=seed^bytes[2],older=bytes[1],last=bytes[2]
  const pattern=[expected.length,0,0,0,...expected]
  for(let i=3;i<bytes.length;i++) {
    const value=bytes[i]^((older+previous)&255)
    older=last;last=bytes[i];previous=value
    if(i>=3+ignore && value!==pattern[i-3-ignore]) return false
  }
  return true
}
function decoder(codepage) {
  const aliases={65001:'utf-8',936:'gbk',950:'big5',932:'shift_jis',949:'euc-kr',874:'windows-874',10000:'macintosh'}
  return new TextDecoder(aliases[codepage]||'windows-'+codepage,{fatal:true})
}
function dirInfo(bytes) {
  const data=view(bytes)
  function record(at) {
    if(at+6>bytes.length) invalid()
    const id=data.getUint16(at,true), size=data.getUint32(at+2,true), begin=at+6, end=begin+size
    if(end>bytes.length) invalid()
    return {id,size,begin,end}
  }
  let pos=0,codepage
  for(const required of [1,2,0x14,3]) {
    let r=record(pos)
    if(required===2 && r.id===0x4a) r=record(r.end)
    if(r.id!==required || r.size!==(required===3?2:4)) invalid()
    if(required===3) codepage=data.getUint16(r.begin,true)
    pos=r.end
  }
  const ansi=decoder(codepage),unicode=new TextDecoder('utf-16le',{fatal:true})
  // PROJECTREFERENCES contains variable-layout records. Locate the modules
  // header and accept it only if the cookie, every typed module record, and
  // the final directory terminator form one complete, unambiguous suffix.
  let modules,attempts=0
  for(let i=pos;i+16<=bytes.length;i++) {
    if(bytes[i]!==0x0f || bytes[i+1]!==0 || data.getUint32(i+2,true)!==2 || data.getUint16(i+8,true)!==0x13 || data.getUint32(i+10,true)!==2) continue
    if(++attempts>4) invalid()
    let index=i+16
    const count=data.getUint16(i+6,true)
    if(count>1024) invalid()
    const found=[]
    for(let n=0;n<count;n++) {
      const module={}, first=record(index)
      if(first.id!==0x19) invalid()
      let r=first
      for(let k=0;;k++) {
        if(k>18 || ![0x19,0x47,0x1a,0x32,0x1c,0x48,0x31,0x1e,0x2c,0x21,0x22,0x25,0x28,0x2b].includes(r.id)) invalid()
        const value=bytes.subarray(r.begin,r.end)
        if(r.id===0x19) module.name=ansi.decode(value)
        if(r.id===0x47 && value.length) module.name=unicode.decode(value)
        if(r.id===0x1a) module.stream=ansi.decode(value)
        if(r.id===0x32 && value.length) module.stream=unicode.decode(value)
        if(r.id===0x31) {if(r.size!==4) invalid();module.offset=data.getUint32(r.begin,true)}
        index=r.end
        if(r.id===0x2b) {if(r.size!==0) invalid();break}
        r=record(index)
      }
      if(!module.name || !module.stream || /[\\/]/.test(module.stream) || module.offset===undefined) invalid()
      found.push(module)
    }
    const terminator=record(index)
    if(terminator.id!==0x10 || terminator.size!==0 || terminator.end!==bytes.length || modules) invalid()
    modules=found
    break
  }
  if(!modules) invalid()
  return {codepage,ansi,modules}
}

export function vbaProject(bytes) {
  const container=read(bytes,{type:'array'})
  const paths=new Map(container.FullPaths.map((p,i)=>[p.toLowerCase(),i]))
  const root=container.FullPaths[0].toLowerCase()
  function stream(path) {
    const entry=container.FileIndex[paths.get(root+path.toLowerCase())]
    if(!entry?.content) invalid()
    return Uint8Array.from(entry.content)
  }
  const manifestBytes=stream('PROJECT'), manifest=new TextDecoder('windows-1252').decode(manifestBytes)
  const publicSource=hasPublicSetting(manifest,'CMG',[0,0,0,0]) && hasPublicSetting(manifest,'DPB',[0]) && hasPublicSetting(manifest,'GC',[255])
  let info
  if(publicSource) try {info=dirInfo(decompressVba(stream('VBA/dir')))} catch { /* Keep the opaque project intact. */ }
  const text=info ? info.ansi.decode(manifestBytes) : manifest
  const modules=[]
  let name
  for(const line of text.split(/\r?\n/)) {
    if(line.startsWith('[')) break
    const m=/^(Document|Module|Class|BaseClass)=(.+)$/i.exec(line)
    if(m) modules.push({type:m[1],name:m[2].split('/&H')[0]})
    const title=/^Name="([^"]+)"$/.exec(line)
    if(title) name=title[1]
  }
  return {
    name,modules,sourceState:!publicSource?'protected':info?'available':'unsupported',codepage:info?.codepage,
    source(moduleName) {
      if(!info) throw Error('此项目的源码未开放，或目录格式无法校验。')
      const match=info.modules.find(m=>m.name.toLowerCase()===moduleName.toLowerCase())
      if(!match || !modules.some(m=>m.name.toLowerCase()===moduleName.toLowerCase())) invalid()
      const bytes=stream('VBA/'+match.stream)
      if(match.offset>=bytes.length) invalid()
      return info.ansi.decode(decompressVba(bytes.subarray(match.offset)))
    },
  }
}
