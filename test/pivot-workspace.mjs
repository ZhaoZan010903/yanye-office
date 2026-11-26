import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import {newSheet} from '../src/modules/spreadsheet.js'
import {readXlsx,writeXlsx} from '../src/modules/spreadsheet-xlsx.js'

const path=process.argv[2]
const cache=await mkdtemp(join(tmpdir(),'yanye-pivot-ui-'))
const source=newSheet('数据')
const rows=[['区域','城市','季度','销售','人员'],['东部','上海','Q1',20,'甲'],['东部','苏州','Q1',15,'乙'],['东部','上海','Q2',30,'乙'],['西部','成都','Q1',42,'甲'],['西部','成都','Q2',21,'乙']]
rows.forEach((row,r)=>row.forEach((v,c)=>{source.cells[String.fromCharCode(65+c)+(r+1)]=String(v)}))
const harness=[
  "import React from 'react';import {createRoot} from 'react-dom/client';import Spreadsheet from '/src/modules/Spreadsheet.jsx';",
  "import {readXlsx,writeXlsx} from '/src/modules/spreadsheet-xlsx.js';import '/src/styles.css';",
  "const root=createRoot(document.querySelector('main')); let session=0;",
  "function Workbook({initial}){const [value,set]=React.useState(initial);window.save=()=>writeXlsx(value);return React.createElement(Spreadsheet,{value,onChange:v=>{set(v);return true}})}",
  "window.open=async bytes=>{const sheets=await readXlsx(bytes);root.render(React.createElement(Workbook,{initial:{sheets,active:sheets[0].id},key:++session}))}",
].join('\n')
const server=await createServer({configFile:false,cacheDir:cache,logLevel:'error',optimizeDeps:{include:['react-dom/client','jszip','exceljs']},
  server:{host:'127.0.0.1',port:0,watch:null},plugins:[{name:'pivot-ui',resolveId(id){if(id==='/pivot-test.js')return id},load(id){if(id==='/pivot-test.js')return harness},
    configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=='/pivot-ui')return next();res.setHeader('Content-Type','text/html;charset=UTF-8');res.end('<main></main><script type="module" src="/pivot-test.js"></script>')})}}]})
let browser
try{
  await server.listen(); browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1536,height:960}}), button=(n,scope=page)=>scope.getByRole('button',{name:n,exact:true})
  page.on('pageerror',e=>console.error(e.message))
  await page.goto(server.resolvedUrls.local[0]+'pivot-ui')
  await page.waitForFunction(()=>typeof window.save!=='function' && !!document.querySelector('main') && window.open.toString().includes('bytes'))
  await page.evaluate(data=>window.open(data),await writeXlsx({sheets:[source]}))
  const ribbon=name=>page.getByRole('tab',{name,exact:true})
  const grid=page.getByRole('region',{name:'工作表网格'})
  assert.equal(await page.getByRole('tab').last().innerText(),'导入导出')
  await grid.locator('[data-address=D2]').click()
  await button('自动换行').click()
  await button('增加缩进').click()
  await grid.locator('[data-address=D3]').click({modifiers:['Shift']})
  await ribbon('页面布局').click()
  await page.getByLabel('纸张大小').selectOption('9')
  await page.getByLabel('纸张方向').selectOption('landscape')
  await page.getByLabel('页边距',{exact:true}).selectOption('窄')
  await button('设置打印区域').click()
  await button('设置顶端标题行').click()
  await page.getByLabel('打印网格线',{exact:true}).check()
  await ribbon('审阅').click()
  await grid.locator('[data-address=G7]').click()
  await grid.press('Shift+F2')
  await page.getByLabel('作者',{exact:true}).fill('林')
  await page.getByLabel('批注内容',{exact:true}).fill('复核预算')
  await button('保存批注').click()
  await grid.locator('[data-address=A1]').click()
  await button('下一条批注').click()
  assert.match(await page.getByLabel('当前批注').innerText(),/G7.*林[\s\S]*复核预算/)
  await ribbon('视图').click()
  await page.getByLabel('网格线',{exact:true}).uncheck()
  await grid.locator('[data-address=D6]').click()
  await ribbon('公式').click()
  await page.locator('summary').filter({hasText:'常用函数'}).click()
  await button('平均值 · AVERAGE').click()
  const roundtrip=(await readXlsx(await page.evaluate(()=>window.save())))[0]
  assert.deepEqual(roundtrip.pageSetup.areas,[{top:1,bottom:2,left:3,right:3}])
  assert.equal(roundtrip.pageSetup.printTitlesRow,'2:3')
  assert.equal(roundtrip.pageSetup.margins.left,.25)
  assert.equal(roundtrip.pageSetup.orientation,'landscape')
  assert.equal(roundtrip.pageSetup.paperSize,9)
  assert.equal(roundtrip.pageSetup.showGridLines,true)
  assert.equal(roundtrip.showGridLines,false)
  assert.equal(roundtrip.styles.D2.indent,1)
  assert.equal(roundtrip.styles.D2.wrap,true)
  assert.deepEqual(roundtrip.notes.G7,{author:'林',text:'复核预算'})
  assert.equal(roundtrip.cells.D7,'=AVERAGE(D6)')
  await ribbon('审阅').click()
  await button('下一条批注').click()
  await button('删除批注').click()
  assert.equal(await grid.locator('[data-note]').count(),0)
  console.log('表格功能区的打印设置、经典批注、换行缩进、函数和视图经过界面操作及 XLSX 读回。')
  await page.evaluate(data=>window.open(data),await writeXlsx({sheets:[source]}))
  await page.getByRole('tab',{name:'数据',exact:true}).click(); await button('数据透视表').click()
  await button('添加行字段').click(); await page.getByLabel('列字段',{exact:true}).selectOption('2')
  await page.getByLabel('值字段',{exact:true}).selectOption('3')
  await page.getByLabel('插入切片器',{exact:true}).selectOption('4')
  await button('在新工作表创建').click()
  let slicer=page.getByRole('region',{name:'人员 切片器'})
  await button('乙',slicer).click(); assert.equal(await page.locator('[data-address=E8]').innerText(),'66')
  await button('多选',slicer).click();await button('甲',slicer).click()
  assert.equal(await page.locator('[data-address=E8]').innerText(),'128')
  await button('多选',slicer).click();await button('甲',slicer).click({modifiers:['Control']})
  assert.equal(await page.locator('[data-address=E8]').innerText(),'66')
  await button('清除筛选',slicer).click()
  assert.equal(await page.locator('[data-address=E8]').innerText(),'128')
  const reloaded=await readXlsx(await page.evaluate(()=>window.save()))
  assert.deepEqual(reloaded[1].pivot.rowFields,[0,1]);assert.equal(reloaded[1].pivot.columnField,2);assert.equal(reloaded[1].pivot.slicers[0].selected,null)
  if(path){
    const native=await readFile(path)
    const sheets=await readXlsx(native.toString('base64'))
    assert.equal(sheets.find(s=>s.name==='报告').pivot.name,'SalesPivot','仅使用专项脚本生成的测试文件')
    await page.evaluate(data=>window.open(data),native.toString('base64'))
    const tabs=page.getByLabel('工作表列表'), grid=page.getByRole('region',{name:'工作表网格'})
    await button('数据',tabs).click()
    await grid.locator('[data-address=D3]').dblclick()
    await page.getByLabel('编辑 D3',{exact:true}).fill('25')
    await page.getByLabel('编辑 D3',{exact:true}).press('Enter')
    await button('报告',tabs).click()
    slicer=page.getByRole('region',{name:'人员 切片器'})
    await button('乙',slicer).click()
    await page.getByRole('tab',{name:'数据',exact:true}).click()
    await button('刷新数据透视表').click()
    assert.equal(await page.locator('[data-address=E8]').innerText(),'76')
    const bytes=Buffer.from(await page.evaluate(()=>window.save()),'base64')
    const after=await readXlsx(bytes.toString('base64'))
    assert.deepEqual(after.find(s=>s.pivot).pivot.slicers[0].selected,['乙'])
    await writeFile(path,bytes)
  }
  console.log('透视表界面新建两级行、列字段、切片器、多选及原生工作簿往返通过。')
}finally{await browser?.close();await server.close();await rm(cache,{recursive:true,force:true})}
