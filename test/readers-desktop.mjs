import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { cpus, platform, release, tmpdir, totalmem } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { _electron } from 'playwright'

const root = resolve(fileURLToPath(new URL('../',import.meta.url)))
const temp = await mkdtemp(join(tmpdir(),'yanye-reader-desktop-'))
const executablePath = process.argv[2] ? resolve(process.argv[2]) : createRequire(import.meta.url)('electron')
const rounds = Number(process.env.YANYE_READER_RUNS || 1)
const inputSamples = Number(process.env.YANYE_TEXT_INPUT || 0)
const pdfFile=join(temp,'工程样本.pdf'), txtFile=join(temp,'大文本.txt'), mixed=join(temp,'会议记录.txt')
const rotated=join(temp,'旋转页面.pdf')
const pdfCopy=join(temp,'副本.pdf'), legacy=join(temp,'旧编码.txt'), utfCopy=join(temp,'转换后的副本.txt')
const samples={pdfOpen:[],pdfJump:[],txtOpen:[],txtJump:[]}
let app, page
const errors=[]
const sha256 = value => createHash('sha256').update(value).digest('hex')

// Ten different 480×480 lossless images recur across the hundred-page report.
function pdfFixture(count,rotation=0) {
  const imageCount=Math.min(10,count), firstPage=4+imageCount, cjkFont=firstPage+count*2
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count '+count+' /Kids ['+Array.from({length:count},(_,i)=>(firstPage+i*2)+' 0 R').join(' ')+'] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let seed=72141
  for(let i=0;i<imageCount;i++) {
    const pixels=Buffer.alloc(480*480*3)
    for(let j=0;j<pixels.length;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0; pixels[j]=seed>>>24}
    const stream=deflateSync(pixels).toString('hex')+'>'
    bodies.push('<< /Type /XObject /Subtype /Image /Width 480 /Height 480 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /FlateDecode] /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream')
  }
  for(let i=1;i<=count;i++) {
    const body='q 0.8 0.85 0.9 rg 60 520 200 70 re f 80 0 0 80 100 400 cm /Logo Do Q\nBT /F1 20 Tf 60 680 Td (Page '+i+' of '+count+(i===82?' ApprovalNeedle':'')+') Tj ET\nBT /F2 16 Tf 60 645 Td <5BA16279> Tj ET'
    bodies.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]'+(rotation?' /Rotate '+rotation:'')+' /Resources << /Font << /F1 3 0 R /F2 '+cjkFont+' 0 R >> /XObject << /Logo '+(4+(i-1)%imageCount)+' 0 R >> >> /Contents '+(firstPage+1+(i-1)*2)+' 0 R >>',
      '<< /Length '+body.length+' >>\nstream\n'+body+'\nendstream')
  }
  bodies.push('<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts ['+(cjkFont+1)+' 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>')
  let result='%PDF-1.7\n'
  const offsets=[0]
  for(let i=0;i<bodies.length;i++) {offsets.push(result.length); result+=(i+1)+' 0 obj\n'+bodies[i]+'\nendobj\n'}
  const start=result.length
  result+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')
  return Buffer.from(result+'trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF\n')
}

function txtFixture() {
  const rows=[], total=10*1024*1024, count=100000
  for(let i=0;i<count;i++) {
    const line='第'+(i+1)+'行 离线 local editor '
    const size=Math.floor((i+1)*total/count)-Math.floor(i*total/count)
    rows.push(line+'x'.repeat(size-Buffer.byteLength(line)-(i===count-1?0:1))+(i===count-1?'':'\n'))
  }
  return rows.join('')
}

const b=name=>page.getByRole('button',{name,exact:true})
const label=name=>page.getByLabel(name,{exact:true})
async function setDialog(path) {
  await app.evaluate(({dialog},path)=>{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})
    dialog.showSaveDialog=async()=>({canceled:false,filePath:path})
  },path)
}
async function openFromHub(path) {
  await setDialog(path)
  const open=b('打开本地文件')
  await open.waitFor()
  await open.click()
}
async function launch(i) {
  app=await _electron.launch({executablePath,args:process.argv[2]?[]:[root],env:{...process.env,YANYE_PROFILE:join(temp,'profile-'+i)}})
  page=await app.firstWindow()
  page.setDefaultTimeout(15000)
  await page.context().setOffline(true)
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',message=>{ if(message.type()==='error') console.error(message.text()) })
  await b('打开本地文件').waitFor()
}
async function ready(selector) {
  await page.locator(selector).first().waitFor()
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
}
async function time(key, event, selector, action, text = '') {
  // Timestamp on the trusted input event. Sample the target at frame boundaries
  // so Playwright's polling interval is never charged to file decoding or paint.
  await page.evaluate(({event,selector,text})=>{
    window.readerMeasurement = new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('等待测量终点超时')),14000)
      document.addEventListener(event,()=>{
        const start=performance.now()
        const sample=()=>{
          const target=text ? [...document.querySelectorAll(selector)].find(el=>el.textContent.includes(text)) : document.querySelector(selector)
          if(target && target.getBoundingClientRect().height>0) requestAnimationFrame(()=>{clearTimeout(timer);resolve(performance.now()-start)})
          else requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      },{once:true,capture:true})
    })
  },{event,selector,text})
  await action()
  samples[key].push(Math.round(await page.evaluate(()=>window.readerMeasurement)))
}
async function run(i) {
  await launch(i)
  await setDialog(pdfFile)
  await time('pdfOpen','click','.pdf-scroll canvas[data-page="1"][data-rendered]',()=>b('打开本地文件').click())
  const canvas=page.locator('.pdf-scroll canvas')
  const colored=await canvas.evaluate(el=>{
    const ctx=el.getContext('2d'), {data}=ctx.getImageData(0,0,el.width,el.height)
    for(let p=0;p<data.length;p+=16) if(data[p+2]-data[p]>15 && data[p+3]>128) return true
    return false
  })
  assert.equal(colored,true,'PDF contains rendered colored graphics')
  await label('跳至 PDF 页码').fill('73')
  await time('pdfJump','keydown','.pdf-scroll canvas[data-page="73"][data-rendered]',()=>label('跳至 PDF 页码').press('Enter'))
  if(i===0) {
    await page.locator('.pdf-scroll .pdf-text').getByText('审批',{exact:true}).waitFor()
    await label('PDF 搜索文字').fill('ApprovalNeedle')
    await b('查找').click()
    await page.locator('.pdf-scroll .pdf-text').getByText('Page 82 of 100 ApprovalNeedle').waitFor()
    await page.getByText('匹配 1 页',{exact:true}).waitFor()
    await label('PDF 缩放').selectOption('0.75')
    await ready('.pdf-scroll canvas[data-rendered]')
    await setDialog(pdfCopy)
    await b('另存为').click()
    await b('副本.pdf').first().waitFor()
    assert.deepEqual(await readFile(pdfCopy),await readFile(pdfFile))
    await b('返回文件中心').click()
    await openFromHub(rotated)
    await page.locator('.pdf-scroll .pdf-text').getByText('审批',{exact:true}).waitFor()
    const aligned=await page.locator('.pdf-scroll .pdf-paper').evaluate(el=>{
      const canvas=el.querySelector('canvas').getBoundingClientRect(), text=el.querySelector('.pdf-text').getBoundingClientRect()
      return canvas.width>canvas.height && ['left','top','right','bottom'].every(k=>Math.abs(canvas[k]-text[k])<=2)
    })
    assert.equal(aligned,true,'rotated selectable text overlays its rendered canvas')
  }
  await b('返回文件中心').click()
  await setDialog(txtFile)
  await time('txtOpen','click','.txt-host .cm-content .cm-line',()=>b('打开本地文件').click(),'第1行')
  await b('跳转到行').click()
  const lineInput=page.locator('.cm-panel input[type=text]').first()
  await lineInput.fill('99999')
  await time('txtJump','keydown','.txt-host .cm-line',()=>lineInput.press('Enter'),'第99999行')
  if (i === rounds-1 && inputSamples > 0) {
    const cdp=await page.context().newCDPSession(page)
    const editor=label('纯文本正文')
    await editor.focus()
    await page.keyboard.press('Control+End')
    samples.txtInput=[]
    for (let n=0;n<inputSamples;n++) {
      const start=performance.now()
      await cdp.send('Input.insertText',{text:'墨'})
      await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))
      samples.txtInput.push(Math.round(performance.now()-start))
    }
    await cdp.detach()
    await page.keyboard.press('Control+s')
    await page.getByText('文件已保存到磁盘',{exact:true}).waitFor()
    assert.ok((await readFile(txtFile,'utf8')).endsWith('墨'.repeat(inputSamples)))
  }
  if(i===0) {
    await b('返回文件中心').click()
    await openFromHub(mixed)
    const editor=label('纯文本正文')
    await editor.click()
    await editor.press('Control+Home')
    await page.keyboard.insertText('复核 ')
    await page.keyboard.press('Control+s')
    await page.getByText('文件已保存到磁盘',{exact:true}).waitFor()
    assert.deepEqual(await readFile(mixed),Buffer.from('\ufeff复核 甲\r\n\r\n乙\n末'))
    await b('查找与替换').click()
    await page.locator('.cm-panel [name=search]').fill('复核')
    await page.locator('.cm-panel input[name=replace]').fill('确认')
    await page.locator('.cm-panel [name=replaceAll]').click()
    await page.keyboard.press('Control+s')
    await page.getByText('文件已保存到磁盘',{exact:true}).waitFor()
    assert.deepEqual(await readFile(mixed),Buffer.from('\ufeff确认 甲\r\n\r\n乙\n末'))
    await b('返回文件中心').click()
    await openFromHub(legacy)
    await b('按此编码打开').click()
    await editor.getByText('中文',{exact:true}).waitFor()
    await setDialog(utfCopy)
    await b('另存为').click()
    await b('转换后的副本.txt').first().waitFor()
    assert.equal(await readFile(utfCopy,'utf8'),'中文')
    assert.deepEqual(await readFile(legacy),Buffer.from([0xd6,0xd0,0xce,0xc4]))
  }
  await app.close()
  app=null
}
try {
  const pdf=pdfFixture(100), txt=txtFixture()
  assert.equal(Buffer.byteLength(txt),10*1024*1024)
  await Promise.all([writeFile(pdfFile,pdf),writeFile(rotated,pdfFixture(1,90)),writeFile(txtFile,txt),writeFile(legacy,Buffer.from([0xd6,0xd0,0xce,0xc4])),
    writeFile(mixed,'\ufeff甲\r\n\r\n乙\n末')])
  for(let i=0;i<rounds;i++) await run(i)
  assert.deepEqual(errors,[])
  const summary=Object.fromEntries(Object.entries(samples).map(([k,v])=>{
    const sorted=[...v].sort((a,b)=>a-b)
    return [k,{n:v.length,p50:sorted[Math.ceil(v.length*.5)-1],p95:sorted[Math.ceil(v.length*.95)-1],max:sorted.at(-1)}]
  }))
  console.log(JSON.stringify({
    version:JSON.parse(await readFile(join(root,'package.json'),'utf8')).version,
    executable:basename(executablePath),
    asarSha256:process.argv[2] ? sha256(await readFile(join(dirname(executablePath),'resources','app.asar'))) : null,
    machine:{os:platform()+' '+release()+' '+process.arch,cpu:cpus()[0].model,memoryGiB:Number((totalmem()/2**30).toFixed(1))},
    fixtures:{pdf:{pages:100,bytes:pdf.length,sha256:sha256(pdf)},txt:{lines:100000,bytes:Buffer.byteLength(txt),sha256:sha256(txt)}},
    rounds,unit:'ms',summary,samples,
  },null,2))
} finally {
  if(app) {
    console.error((await page?.locator('body').innerText().catch(()=>''))?.slice(-1100))
    await app.close().catch(()=>{})
  }
  await rm(temp,{recursive:true,force:true,maxRetries:5})
}
