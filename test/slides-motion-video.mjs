// Sample Office's own rendered frames. The native fixture uses dark text on
// white and one magenta ellipse, so the two observables do not overlap.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'

const movie=await readFile(process.argv[2])
const browser=await chromium.launch({channel:'msedge',headless:true})
try {
  const page=await browser.newPage()
  const frames=await page.evaluate(async encoded=>{
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],{type:'video/mp4'}))
    const video=document.createElement('video'),canvas=document.createElement('canvas')
    const ready=new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(Error(video.error.message))})
    video.src=url;await ready
    canvas.width=video.videoWidth;canvas.height=video.videoHeight
    const {width:w,height:h}=canvas,ctx=canvas.getContext('2d',{willReadFrequently:true})
    const observations=[]
    for(let t=.035;t<video.duration;t+=.12) {
      const seeked=new Promise(resolve=>{video.onseeked=resolve})
      video.currentTime=t;await seeked
      ctx.drawImage(video,0,0)
      const rgba=ctx.getImageData(0,0,w,h).data
      let count=0,sx=0,sy=0
      const rows=[]
      for(let y=0;y<h;y+=2) {
        let dark=0
        for(let x=0;x<w;x+=2) {
          const i=(w*y+x)*4,r=rgba[i],g=rgba[i+1],b=rgba[i+2]
          if(r>130 && g<85 && b>75 && r>g*1.6) {count++;sx+=x;sy+=y}
          if(x<w*.65 && y<h*.53 && r<120 && g<120 && b<120) dark++
        }
        if(dark>=2)rows.push(y)
      }
      const bands=rows.filter((v,i)=>!i || v>rows[i-1]+6).length
      observations.push({t:Number(t.toFixed(2)),bands,x:count?sx/count/w:null,y:count?sy/count/h:null})
    }
    URL.revokeObjectURL(url);return observations
  },movie.toString('base64'))
  const textStates=[...new Set(frames.map(f=>f.bands))]
  const positions=frames.filter(f=>f.x!==null)
  const first=positions[0],last=positions.at(-1)
  assert.ok(first && last,'未在视频中识别校样的洋红运动对象。')
  const top=Math.min(...positions.map(f=>f.y))
  assert.ok(textStates.includes(1) && textStates.includes(2) && textStates.includes(3),JSON.stringify({textStates}))
  assert.ok(first.y-top>.1 && last.x-first.x>.39 && last.y-first.y>.02,JSON.stringify({first,top,last}))
  console.log(JSON.stringify({movie:process.argv[2],sampledFrames:frames.length,textStates,start:first,highestY:top,end:last}))
} finally {await browser.close()}
