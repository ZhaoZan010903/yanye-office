import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import {newSheet} from '../src/modules/spreadsheet.js'
import {readXlsx,writeXlsx} from '../src/modules/spreadsheet-xlsx.js'
import {openProjectReader} from '../src/modules/preserved-workbook.js'

const macroFile=process.argv[2]
if(!macroFile) throw Error('请提供 XlsxWriter 的公开样本 macro01.xlsm 文件路径。')
const source=newSheet('明细')
source.cells={A1:'地区',B1:'金额',A2:'东',B2:'20',A3:'西',B3:'30',A4:'东',B4:'15'}
const cache=await mkdtemp(join(tmpdir(),'yanye-workbook-ui-'))
const harness=`
import React from 'react'
import {createRoot} from 'react-dom/client'
import Spreadsheet from '/src/modules/Spreadsheet.jsx'
import PreservedWorkbook from '/src/modules/PreservedWorkbook.jsx'
import {readOfficeFile,writeOfficeFile} from '/src/office-files.js'
import '/src/styles.css'
const root=createRoot(document.querySelector('main'))
function Workbook({initial,disk}) {
  const [value,setValue]=React.useState(initial)
  window.serialize=()=>writeOfficeFile({kind:'spreadsheet',disk,content:value},window.yanye.library.readWorkbookBase)
  return React.createElement(value.preserved?PreservedWorkbook:Spreadsheet,{value,disk,onChange:v=>{setValue(v);return true}})
}
window.openWorkbook=async(extension,content)=>{
  const bytes=Uint8Array.from(atob(content),c=>c.charCodeAt(0))
  window.yanye={library:{readWorkbookBase:async()=>bytes}}
  const disk={extension,id:'ui-sample',revision:'sample'}
  const file=await readOfficeFile({extension,content})
  if(file.content.preserved) file.content.preserved.base=disk
  root.render(React.createElement(Workbook,{initial:file.content,disk,key:extension}))
}
`
const server=await createServer({configFile:false,cacheDir:cache,logLevel:'error',
  optimizeDeps:{entries:['src/modules/Spreadsheet.jsx','src/modules/PreservedWorkbook.jsx'],include:['react-dom/client','cfb','jszip','exceljs']},
  server:{host:'127.0.0.1',port:0,watch:null},plugins:[{
    name:'workbook-ui',resolveId(id){if(id==='/workbook-ui.js')return id},load(id){if(id==='/workbook-ui.js')return harness},
    configureServer(server){server.middlewares.use((req,res,next)=>{
      if(req.url!=='/workbook-ui')return next()
      res.setHeader('Content-Type','text/html;charset=UTF-8')
      res.end('<!doctype html><main></main><script type="module" src="/workbook-ui.js"></script>')
    })}
  }]})
let browser
try {
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1440,height:920}})
  page.setDefaultTimeout(30000)
  page.on('pageerror',e=>console.error(e.stack))
  await page.goto(server.resolvedUrls.local[0]+'workbook-ui')
  await page.waitForFunction(()=>window.openWorkbook)
  async function open(ext,data){await page.evaluate(([e,d])=>window.openWorkbook(e,d),[ext,data])}
  const button=name=>page.getByRole('button',{name,exact:true})
  await open('xlsx',await writeXlsx({sheets:[source],active:source.id}))
  await page.getByRole('tab',{name:'数据',exact:true}).click()
  await button('数据透视表').click()
  await page.getByLabel('汇总方式').selectOption('sum')
  await button('在新工作表创建').click()
  await button('透视表字段').click()
  await page.getByLabel('汇总方式').selectOption('average')
  await button('应用字段设置').click()
  await button('刷新数据透视表').click()
  const sheets=await readXlsx(await page.evaluate(()=>window.serialize()))
  assert.equal(sheets[1].pivot.summary,'average')
  assert.equal(sheets[1].cells.B2,'17.5')
  const original=await readFile(macroFile)
  await open('xlsm',original.toString('base64'))
  await button('查看 VBA 项目').click()
  const selectModule=page.getByLabel('VBA 模块',{exact:true})
  await selectModule.selectOption('Sheet1')
  assert.match(await page.getByLabel('VBA 模块源码').inputValue(),/VB_Name = "Sheet1"/)
  await selectModule.selectOption('Module1')
  const code=page.getByLabel('VBA 模块源码')
  assert.match(await code.inputValue(),/Sub Macro1\(\)/i)
  assert.equal(await code.getAttribute('readonly'),'')
  await page.getByLabel('定位单元格').fill('B3')
  await page.getByLabel('定位单元格').press('Enter')
  await page.getByLabel('单元格常量').fill('宏保留-界面')
  const result=await page.evaluate(()=>window.serialize())
  assert.equal((await readXlsx(result))[0].cells.B3,'宏保留-界面')
  const project=await openProjectReader(Buffer.from(result,'base64'))
  assert.match(project.source('Module1'),/Sub Macro1\(\)/i)
  console.log('Edge 实际组件验证通过：透视表创建、设置、刷新和回读；XLSM 源码选择、只读展示、常量编辑和回读。')
} finally {
  await browser?.close()
  await server.close()
  await rm(cache,{recursive:true,force:true})
}
