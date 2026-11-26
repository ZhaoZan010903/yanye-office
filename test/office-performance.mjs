// node test/office-performance.mjs [YanYe.exe or - for development] [rounds; default 30] [result.json]
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import JSZip from 'jszip'
import { _electron } from 'playwright'
import { address, newSheet } from '../src/modules/spreadsheet.js'
import { writeXlsx } from '../src/modules/spreadsheet-xlsx.js'
import { writeDocx } from '../src/modules/word-docx.js'

const root=resolve(fileURLToPath(new URL('../',import.meta.url)))
const packaged=!!process.argv[2] && process.argv[2]!=='-'
const executablePath=packaged ? resolve(process.argv[2]) : createRequire(import.meta.url)('electron')
const rounds=Number(process.argv[3] ?? 30)
assert.ok(Number.isInteger(rounds) && rounds>0 && rounds<=200)
const directory=await mkdtemp(join(tmpdir(),'yanye-office-perf-'))
const files={docx:join(directory,'现场评审.docx'),xlsx:join(directory,'现场明细.xlsx')}
const raw=[]
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]})
const image={type:'image',attrs:{width:16,height:16,alt:'样本图',
  src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6ioAAAAASUVORK5CYII='}}

async function fixtures() {
  const content=[]
  const text='本地办公项目进度记录与合同履约情况'.repeat(12).slice(0,200).padEnd(200,'。')
  for (let i=0;i<30;i++) {
    if (i) content.push({type:'pageBreak'})
    for (let j=0;j<5;j++) content.push(paragraph(text))
    if (i<10) content.push({type:'table',content:[{type:'tableRow',content:['项目','进度'].map(s=>({type:'tableCell',content:[paragraph(s)]}))}]})
    if (i<5) content.push({type:'paragraph',content:[image]})
  }
  const sheets=['项目','结算'].map(name=>{
    const sheet=newSheet(name)
    sheet.rows=1000; sheet.cols=10
    for (let row=0;row<1000;row++) for (let col=0;col<10;col++) {
      sheet.cells[address(row,col)]=col===9 ? '=A'+(row+1)+'+B'+(row+1) : String((row+1)*(col+1))
    }
    return sheet
  })
  const output={}
  for (const [format,base64] of [['docx',await writeDocx({doc:{type:'doc',content}})],['xlsx',await writeXlsx({sheets})]]) {
    const zip=await JSZip.loadAsync(base64,{base64:true})
    const props=zip.file('docProps/core.xml')
    if (props) zip.file(props.name,(await props.async('string')).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g,'2000-01-01T00:00:00Z'))
    for (const entry of Object.values(zip.files)) entry.date=new Date('2000-01-01T00:00:00Z')
    output[format]=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})
  }
  return output
}

async function duration(action) {
  const start=performance.now()
  await action()
  return Math.round(performance.now()-start)
}

async function runRound(index,binaries) {
  const app=await _electron.launch({executablePath,args:packaged?[]:[root],env:{...process.env,YANYE_PROFILE:join(directory,'profile-'+index)}})
  const sample={round:index}
  try {
    const page=await app.firstWindow()
    await page.context().setOffline(true)
    page.setDefaultTimeout(20000)
    const button=name=>page.getByRole('button',{name,exact:true})
    const confirm=button('备份并保存原文件')
    const written=page.getByText('文件已保存到磁盘',{exact:true})
    const dirty=page.getByText('草稿已保存 · 文件有未写入的修改',{exact:true})
    for (const format of (index%2 ? ['xlsx','docx'] : ['docx','xlsx'])) {
      await writeFile(files[format],binaries[format])
      await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},files[format])
      const open=button('打开本地文件')
      await open.waitFor()
      const editor=page.getByLabel('Word 文档正文')
      const formula=page.getByLabel('公式栏')
      sample[format+'OpenMs']=await duration(async()=>{
        await open.click()
        if (format==='docx') {
          await editor.locator('p').first().waitFor()
          assert.equal(await editor.getAttribute('contenteditable'),'true')
        } else {
          await formula.waitFor()
          assert.equal(await page.locator('td[data-address="J1"]').innerText(),'3')
        }
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
      })
      // Authorize the first overwrite before the measured Ctrl+S.
      async function edit(value) {
        if (format==='docx') { await editor.press('Control+Home'); await page.keyboard.insertText(value) }
        else { await page.locator('td[data-address="A1"]').click(); await formula.fill(value) }
        await dirty.waitFor()
      }
      await edit('8')
      await page.keyboard.press('Control+s')
      await confirm.click()
      await written.waitFor()
      await edit('17')
      sample[format+'SaveMs']=await duration(async()=>{
        await page.keyboard.press('Control+s')
        await written.waitFor()
      })
      const archive=await JSZip.loadAsync(await readFile(files[format]))
      if (format==='docx') {
        const xml=await archive.file('word/document.xml').async('string')
        assert.match(xml,/178本地办公/)
        assert.equal((xml.match(/<w:tbl>/g)||[]).length,10)
        assert.equal((xml.match(/<w:drawing>/g)||[]).length,5)
      } else {
        const xml=await archive.file('xl/worksheets/sheet1.xml').async('string')
        assert.match(xml,/<c r="A1"[^>]*><v>17<\/v>/)
        assert.match(xml,/<c r="J1"[^>]*><f>A1\+B1<\/f><v>19<\/v>/)
      }
      await button('返回文件中心').click()
    }
    return sample
  } finally { await app.close() }
}

try {
  const binaries=await fixtures()
  const machine={os:[platform(),release(),arch()].join(' '),cpu:cpus()[0].model,memoryGiB:+(totalmem()/2**30).toFixed(1)}
  const manifest=Object.fromEntries(Object.entries(binaries).map(([key,value])=>[key,{bytes:value.length,sha256:digest(value)}]))
  console.log(JSON.stringify({machine,executablePath,fixtures:manifest}))
  let warmup
  for (let i=0;i<=rounds;i++) {
    const sample=await runRound(i,binaries)
    console.log(JSON.stringify(sample))
    if (i>0) raw.push(sample)
    else warmup=sample
  }
  const summary={}
  for (const key of ['docxOpenMs','docxSaveMs','xlsxOpenMs','xlsxSaveMs']) {
    const sorted=raw.map(item=>item[key]).sort((a,b)=>a-b)
    summary[key]={p50:sorted[Math.ceil(0.5*rounds)-1],p95:sorted[Math.ceil(0.95*rounds)-1],max:sorted.at(-1)}
  }
  console.log(JSON.stringify({rounds,summary}))
  if (process.argv[4]) {
    const version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version
    const asarSha256=packaged ? digest(await readFile(join(dirname(executablePath),'resources','app.asar'))) : null
    const report={version,asarSha256,executable:basename(executablePath),machine,fixtures:manifest,rounds,summary,warmup,samples:raw}
    await writeFile(resolve(process.argv[4]),JSON.stringify(report,null,2)+'\n')
  }
} finally {
  if (dirname(directory)===tmpdir() && basename(directory).startsWith('yanye-office-perf-')) await rm(directory,{recursive:true,force:true,maxRetries:5})
}
