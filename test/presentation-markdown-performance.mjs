import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import JSZip from 'jszip'
import { _electron } from 'playwright'
import { exportPptx } from '../src/modules/slides-pptx.js'

const packaged=process.argv[2]!=='-'
const executable=packaged?resolve(process.argv[2] || 'release/YanYe-win32-x64/YanYe.exe'):createRequire(import.meta.url)('electron')
const launchArgs=packaged?[]:[resolve(fileURLToPath(new URL('../',import.meta.url)))]
const rounds=Number(process.argv[3] || 30)
assert.ok(Number.isInteger(rounds) && rounds>0 && rounds<=200)
const output=process.argv[4] && resolve(process.argv[4])
const temp=await mkdtemp(join(tmpdir(),'yanye-ppt-md-perf-'))
const asar=join(dirname(executable),'resources','app.asar')
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex')
const title=n=>'项目评审 · 第 '+String(n).padStart(2,'0')+' 页'
const notes=n=>'第 '+n+' 页讲者备注：核对本阶段测量记录。'
const firstHeading='本地协作工作记录'
const updatedTitle='已校订 · '+title(1), appendix='附记：本机保存与重开校验。'
const budget={pptxOpen:2500,mdOpen:1000,cachedNext:100}
const timeout=45000

function chunk(type,data) {
  const tag=Buffer.from(type),result=Buffer.alloc(data.length+12)
  result.writeUInt32BE(data.length,0);tag.copy(result,4);data.copy(result,8)
  result.writeUInt32BE(crc32(data,crc32(tag)),data.length+8)
  return result
}

// Each page has its own deterministic 600 × 360 RGB field map and 12 bars.
function chartImage(n) {
  const width=600,height=360,stride=width*3+1,rows=Buffer.alloc(height*stride)
  let seed=1009*n
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    seed=(Math.imul(1664525,seed)+1013904223)>>>0
    const noise=seed>>>29, col=Math.floor(x/50),bar=x%50>12 && x%50<36 && y>180-((col*33+n*7)%142) && y<288
    const at=y*stride+1+x*3
    rows[at]=(bar?42:98)+Math.floor(x/9)+noise
    rows[at+1]=(bar?99:112)+Math.floor(y/8)+noise
    rows[at+2]=(bar?102:142)+((col+n)%5)*8+noise
  }
  const header=Buffer.alloc(13)
  header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))])
}

function markdownFixture() {
  let text='# '+firstHeading+'\n\n',size=Buffer.byteLength(text),sections=0
  const length=1024*1024
  while (size<length) {
    const n=sections+1
    const heading=(n%8===1?'##':'###')+' 阶段 '+n+' 的记录\n\n'
    const paragraphs=Array.from({length:6},(_,i)=>
      '记录 '+n+'.'+(i+1)+'。本轮采用纸质登记表与离线文件交叉核验，记录收集地点、交接时间和负责人。'+
      '复核完成后，团队把每条变更与上次交付内容逐项比对，保留原始条目和本次修订理由。'+
      'The working copy retains the local file, revision, document owner and review result.').join('\n\n')
    const section=heading+paragraphs+'\n\n```javascript\nconst stage = '+n+';\nconst accepted = records.filter(row => row.stage === stage);\n```\n\n'
    const extra=Buffer.byteLength(section)
    if (size+extra>length) break
    text+=section;size+=extra;sections++
  }
  const tail='Review record. '
  text+=tail.repeat(Math.ceil((length-size)/tail.length)).slice(0,length-size)
  assert.equal(Buffer.byteLength(text),length)
  return {bytes:Buffer.from(text),sections}
}

async function fixtures() {
  const md=markdownFixture(),images=Array.from({length:20},(_,i)=>chartImage(i+1))
  const slides=Array.from({length:30},(_,i)=>({
    title:title(i+1),body:'复核流程与阶段性数据 · '+(i+1),layout:i<20?'image':'text',notes:notes(i+1),
    textBoxes:[{text:'记录编号 '+(i+1),x:.09,y:.85,w:.3,h:.09,color:'37352F',fontFace:'Arial',fontSize:15,align:'left'}],
    ...(i<20?{image:{name:'第 '+(i+1)+' 页图表',width:600,height:360,data:'data:image/png;base64,'+images[i].toString('base64')}}:{}),
  }))
  const zip=await JSZip.loadAsync(await exportPptx({theme:'paper',slides},'项目评审'),{base64:true})
  const props=zip.file('docProps/core.xml')
  zip.file(props.name,(await props.async('string')).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g,'2000-01-01T00:00:00Z'))
  for(const file of Object.values(zip.files)) file.date=new Date('2000-01-01T00:00:00Z')
  const pptx=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})
  assert.ok(pptx.length<=10*1024*1024)
  return {md:md.bytes,pptx,sections:md.sections,images:images.map(sha256),positions:await objectPositions(zip)}
}

async function objectPositions(zip) {
  const result=[]
  for(let n=1;n<=30;n++) {
    const slide=await zip.file('ppt/slides/slide'+n+'.xml').async('string')
    const transforms=[...slide.matchAll(/<a:xfrm\b[^>]*>([\s\S]*?)<\/a:xfrm>/g)].map(m=>m[1])
    assert.ok(transforms.length>=3)
    result.push(transforms)
  }
  return result
}

async function verifyPptx(path,fixtures) {
  const zip=await JSZip.loadAsync(await readFile(path))
  assert.equal(zip.file(/^ppt\/slides\/slide\d+\.xml$/).length,30)
  assert.deepEqual(await objectPositions(zip),fixtures.positions)
  for (let n=1;n<=30;n++) {
    const slide=await zip.file('ppt/slides/slide'+n+'.xml').async('string')
    const note=await zip.file('ppt/notesSlides/notesSlide'+n+'.xml').async('string')
    assert.ok(slide.includes(n===1?updatedTitle:title(n)))
    assert.ok(note.includes(notes(n)))
    assert.ok(slide.includes('记录编号 '+n+'<'))
    if (n<=20) {
      const target=zip.file('ppt/slides/_rels/slide'+n+'.xml.rels')
      const relationship=(await target.async('string')).match(/Target="\.\.\/media\/([^"]+\.png)"/)
      assert.ok(relationship)
      assert.equal(sha256(await zip.file('ppt/media/'+relationship[1]).async('nodebuffer')),fixtures.images[n-1])
    }
  }
}

// Start from the trusted renderer event, then wait one extra frame after the
// actual visible editor or projected text and decoded image are present.
async function measure(page,event,kind,expected,action) {
  await page.evaluate(({event,kind,expected,timeout})=>{
    window.fileTiming=new Promise(resolve=>{
      const timer=setTimeout(()=>resolve(null),timeout)
      document.addEventListener(event,e=>{
        const start=e.timeStamp
        const sample=()=>{
          let target,ready,mode
          if(kind==='mdEnd' || kind==='mdInput') {
            target=document.querySelector('textarea[aria-label="Markdown 源码"]')
            ready=target && (kind==='mdEnd' ? target.selectionStart===target.textLength && target.selectionEnd===target.textLength :
              target.value.endsWith(expected))
            if (!target) {
              target=document.querySelector('.md-source-large .cm-content[contenteditable=true]')
              const last=target?.querySelector('.cm-line:last-child')?.textContent
              ready=kind==='mdEnd'?last===expected:last?.endsWith(expected)
            }
          } else if(kind==='mdOpen' || kind==='mdRichSwitch') {
            target=document.querySelector('.writing-area[contenteditable=true]')
            ready=target?.getBoundingClientRect().height>0 && target?.querySelector('h1')?.textContent===expected
            mode='rich'
            if (!ready && kind==='mdOpen') {
              target=document.querySelector('textarea[aria-label="Markdown 源码"]')
              ready=target && !target.readOnly && target.value.startsWith('# '+expected+'\n')
              mode='source'
              if(!ready) {
                target=document.querySelector('.md-source-large .cm-content[contenteditable=true]')
                ready=target?.querySelector('.cm-line')?.textContent==='# '+expected
                mode='virtual-source'
              }
            }
          } else {
            target=document.querySelector(kind==='pptxOpen'?'.slides-editor textarea.slides-title':'.slides-show .slides-title')
            const img=target?.closest('.slides-page')?.querySelector('.slides-image-box img')
            ready=(kind==='pptxOpen'?target && !target.readOnly && target.value:target?.textContent)===expected && img?.complete && img.naturalWidth===600
          }
          if (ready && target.getBoundingClientRect().height>0) requestAnimationFrame(()=>{
            clearTimeout(timer);resolve({ms:Math.round(performance.now()-start),mode})
          })
          else if(performance.now()-start>timeout) {clearTimeout(timer);resolve(null)}
          else requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      },{once:true,capture:true})
    })
  },{event,kind,expected,timeout})
  await action()
  const timing=await page.evaluate(()=>window.fileTiming)
  if(timing==null) throw new Error(kind+' exceeded '+timeout+' ms')
  return timing
}

async function run(index,data) {
  const app=await _electron.launch({executablePath:executable,args:launchArgs,env:{...process.env,YANYE_PROFILE:join(temp,'profile-'+index)}})
  const sample={round:index,cachedNext:[]}
  try {
    const page=await app.firstWindow()
    page.setDefaultTimeout(timeout)
    await page.context().setOffline(true)
    const button=name=>page.getByRole('button',{name,exact:true}), label=name=>page.getByLabel(name,{exact:true})
    const errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    for (const format of index%2?['md','pptx']:['pptx','md']) {
      const input=join(temp,'项目样本.'+format),output=join(temp,'校订-'+index+'.'+format)
      await app.evaluate(({dialog},{input,output})=>{
        dialog.showOpenDialog=async()=>({canceled:false,filePaths:[input]})
        dialog.showSaveDialog=async()=>({canceled:false,filePath:output})
        dialog.showMessageBox=async()=>({response:1})
      },{input,output})
      const open=button('打开本地文件')
      await open.waitFor()
      const opened=await measure(page,'click',format+'Open',format==='pptx'?title(1):firstHeading,()=>open.click())
      sample[format+'Open']=opened.ms
      if(format==='pptx') {
        await button('放映').click()
        await page.locator('.slides-show .slides-title').getByText(title(1),{exact:true}).waitFor()
        // Visit 2..8 once to decode/cache each slide; measure seven forward transitions per process.
        for(let n=2;n<=8;n++) {
          await page.keyboard.press('ArrowRight')
          await page.locator('.slides-show .slides-title').getByText(title(n),{exact:true}).waitFor()
          await page.waitForFunction(()=>document.querySelector('.slides-show img')?.naturalWidth===600)
        }
        for(let n=7;n>=1;n--) {
          await page.keyboard.press('ArrowLeft')
          await page.locator('.slides-show .slides-title').getByText(title(n),{exact:true}).waitFor()
        }
        for(let n=2;n<=8;n++) sample.cachedNext.push((await measure(page,'keydown','cachedNext',title(n),()=>page.keyboard.press('ArrowRight'))).ms)
        await page.keyboard.press('Escape')
        await page.getByRole('button',{name:/^第 1 页 /}).click()
        await label('幻灯片标题').fill(updatedTitle)
        assert.equal(await label('演讲者备注').inputValue(),notes(1))
      } else {
        const source=label('Markdown 源码')
        sample.mdOpenMode=opened.mode
        if(opened.mode!=='rich') {
          const virtual=opened.mode==='virtual-source', raw=data.md.toString('utf8')
          // Copy into an event-local DataTransfer to inspect the full editor model;
          // native clipboard contents and visible-only CodeMirror DOM stay untouched.
          const selected=()=>source.evaluate(el=>{
            const data=new DataTransfer()
            el.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}))
            return data.getData('text/plain')
          })
          const fullSource=async()=>{
            if(!virtual) return source.inputValue()
            await source.press('Control+a')
            return selected()
          }
          assert.equal(await fullSource(),raw)
          await source.press('Control+Home')
          await source.focus()
          sample.mdEnd=(await measure(page,'keydown','mdEnd',raw.slice(raw.lastIndexOf('\n')+1),()=>page.keyboard.press('Control+End'))).ms
          sample.mdInput=(await measure(page,'beforeinput','mdInput',appendix,()=>page.keyboard.insertText(appendix))).ms
          await source.press('Control+z')
          assert.equal(await fullSource(),raw)
          if(virtual) {
            await source.press('Control+Home');await source.press('End');await source.press('Shift+Home')
            assert.equal(await selected(),'# '+firstHeading)
          } else await source.evaluate(el=>el.setSelectionRange(2,11,'backward'))
          sample.mdRichSwitch=(await measure(page,'click','mdRichSwitch',firstHeading,()=>button('富文本').click())).ms
          await button('源码').click()
          if(virtual) assert.equal(await selected(),'# '+firstHeading)
          else assert.deepEqual(await source.evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection]),[2,11,'backward'])
          if(!index) {
            await button('阅读').click()
            await label('Markdown 阅读正文').getByRole('heading',{name:firstHeading,exact:true}).waitFor()
            await button('源码').click()
          }
        } else await button('源码').click()
        await source.press('Control+End')
        await page.keyboard.insertText(appendix)
      }
      await button('另存为').click()
      await button(basename(output)).first().waitFor()
      if(format==='pptx') await verifyPptx(output,data)
      else assert.deepEqual(await readFile(output),Buffer.concat([data.md,Buffer.from(appendix)]))
      await button('返回文件中心').click()
    }
    assert.deepEqual(errors,[])
    return sample
  } finally { await app.close() }
}

const q=(sorted,f)=>sorted[Math.ceil(sorted.length*f)-1]
try {
  const data=await fixtures()
  for(const f of ['md','pptx']) await writeFile(join(temp,'项目样本.'+f),data[f])
  const asarSha256=packaged?sha256(await readFile(asar)):null
  const report={version:JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version,asarSha256,
    executable:basename(executable),machine:{os:platform()+' '+release()+' '+arch(),cpu:cpus()[0].model,memoryGiB:+(totalmem()/2**30).toFixed(1)},
    fixtures:{md:{bytes:data.md.length,sha256:sha256(data.md),encoding:'UTF-8',eol:'LF',headingLevels:3,headings:data.sections+1,codeBlocks:data.sections},
      pptx:{bytes:data.pptx.length,sha256:sha256(data.pptx),slides:30,distinctImages:20,imageSize:[600,360],notes:30,positionedTextBoxes:30}},
    timing:'From trusted click or keydown to the frame after visible editable content (and the current decoded slide image). Alternate open order, fresh offline process/profile per round, seven cached forward switches per process.',
    verification:'Read each saved PPTX archive, compare all 30 titles, notes and transforms, resolve per-page image relationships and compare all 20 PNG hashes. Compare saved Markdown with source plus the single intentional UTF-8 append byte-for-byte.',
    requestedRounds:rounds,warmup:null,unit:'ms',samples:[],failures:[],summary:{}}
  console.log(JSON.stringify({fixtures:report.fixtures,asarSha256}))
  for(let i=0;i<=rounds;i++) {
    try {
      const row=await run(i,data)
      if(i) report.samples.push(row)
      else report.warmup=row
      console.log(JSON.stringify(row))
    } catch(error) {
      report.failures.push({round:i,message:error.message})
      console.error('Round '+i+': '+error.message)
      if(!i) throw error
    }
  }
  for (const [key,limit] of Object.entries({...budget,mdRichSwitch:null,mdEnd:null,mdInput:null})) {
    const sorted=report.samples.flatMap(s=>s[key]??[]).sort((a,b)=>a-b)
    report.summary[key]={n:sorted.length,p50:q(sorted,.5)??null,p95:q(sorted,.95)??null,max:sorted.at(-1)??null,
      limit,pass:limit==null?null:report.failures.length===0 && sorted.length>0 && q(sorted,.95)<=limit}
  }
  if(packaged) assert.equal(sha256(await readFile(asar)),asarSha256)
  if(output) await writeFile(output,JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({summary:report.summary,failures:report.failures}))
  if (report.failures.length) process.exitCode=1
} finally {
  if(dirname(temp)===resolve(tmpdir()) && basename(temp).startsWith('yanye-ppt-md-perf-')) await rm(temp,{recursive:true,force:true,maxRetries:5})
}
