import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import JSZip from 'jszip'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import {makePage} from '../shared/workspace.mjs'
import {writeDocx} from '../src/modules/word-docx.js'

const fresh=makePage({kind:'word'}).content
const original=await JSZip.loadAsync(await writeDocx({layout:{top:12,bottom:16,left:21,right:27}}),{base64:true})
const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
original.file('word/styles.xml','<w:styles xmlns:w="'+w+'">'+
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="仿宋" w:ascii="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>'+
  '<w:style w:type="paragraph" w:styleId="基础"><w:rPr><w:rFonts w:eastAsia="楷体"/><w:sz w:val="26"/></w:rPr></w:style>'+
  '<w:style w:type="paragraph" w:styleId="正文" w:default="1"><w:basedOn w:val="基础"/><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="29"/></w:rPr></w:style></w:styles>')
original.file('word/theme/theme1.xml','<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:minorFont><a:latin typeface="Cambria"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>')
const samples=[
  ['new',await writeDocx(fresh),{font:'宋体',latinFont:'宋体',size:10.5},[25.4,25.4,31.8,31.8]],
  ['import',await original.generateAsync({type:'base64'}),{font:'楷体',latinFont:'Cambria',size:14.5},[12,16,21,27]],
  ['legacy',await writeDocx({}),{font:'Microsoft YaHei',latinFont:'Calibri',size:11},[25.4,25.4,25.4,25.4]],
]
const cache=await mkdtemp(join(tmpdir(),'yanye-word-defaults-'))
const harness=`
import React from 'react';import {createRoot} from 'react-dom/client'
import Word from '/src/modules/Word.jsx'
import {readDocx,writeDocx} from '/src/modules/word-docx.js'
const root=createRoot(document.querySelector('main')); let n=0
function Sample({initial}){const [value,set]=React.useState(initial);window.save=()=>writeDocx(value);return React.createElement(Word,{value,onChange:set})}
window.openSample=async data=>root.render(React.createElement(Sample,{key:++n,initial:await readDocx(data)}))
window.readSaved=async()=>readDocx(await window.save())
`
const server=await createServer({configFile:false,cacheDir:cache,logLevel:'error',server:{host:'127.0.0.1',port:0,watch:null},
  optimizeDeps:{entries:['src/modules/Word.jsx'],include:['react-dom/client','jszip']},
  plugins:[{name:'word-defaults-ui',resolveId(id){if(id==='/sample.js')return id},load(id){if(id==='/sample.js')return harness},
    configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=='/sample')return next();res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><style>main{height:100vh;display:flex}</style><main></main><script type="module" src="/sample.js"></script>')})}}]})
let browser
try {
  await server.listen()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const page=await browser.newPage({viewport:{width:1280,height:900}})
  await page.goto(server.resolvedUrls.local[0]+'sample')
  await page.waitForFunction(()=>!!window.openSample)
  for (const [name,input,defaults,margins] of samples) {
    await page.evaluate(bytes=>window.openSample(bytes),input)
    const font=page.getByLabel('字体',{exact:true})
    await page.waitForFunction(expected=>document.querySelector('select[aria-label="字体"]')?.value===expected,defaults.font)
    assert.equal(await font.inputValue(),defaults.font)
    assert.equal(await page.getByLabel('西文字体',{exact:true}).inputValue(),defaults.latinFont)
    assert.equal(Number(await page.getByLabel('字号',{exact:true}).inputValue()),defaults.size)
    const body=page.getByRole('textbox',{name:'Word 文档正文'})
    const css=await body.evaluate(el=>({size:parseFloat(getComputedStyle(el).fontSize),font:getComputedStyle(el).fontFamily}))
    assert.ok(Math.abs(css.size-defaults.size*4/3)<.02)
    assert.ok(css.font.includes(defaults.font) && css.font.includes(defaults.latinFont))
    await body.fill('中文与 Latin')
    const saved=await page.evaluate(()=>window.readSaved())
    assert.deepEqual(saved.textDefaults,defaults)
    assert.equal(saved.doc.content[0].content[0].text,'中文与 Latin')
    const actual=['top','bottom','left','right'].map(key=>saved.layout[key])
    assert.ok(actual.every((mm,i)=>Math.abs(mm-margins[i])<.02),JSON.stringify(actual))
    if (name==='new') {
      await page.getByRole('tab',{name:'页面',exact:true}).click()
      assert.equal(await page.getByRole('combobox',{name:'页边距',exact:true}).inputValue(),'standard')
      await page.getByRole('tab',{name:'开始',exact:true}).click()
      await body.click()
      await page.getByLabel('段落样式').selectOption('1')
      const heading=body.getByRole('heading',{level:1})
      await heading.click()
      assert.equal(await page.getByLabel('字号',{exact:true}).inputValue(),'20')
      assert.ok(Math.abs(await heading.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))-20*4/3)<.02)
      await page.getByLabel('字号',{exact:true}).selectOption('12')
      assert.equal(await page.getByLabel('字号',{exact:true}).inputValue(),'12')
    }
    console.log(name,defaults,actual.map(mm=>Number(mm.toFixed(2))))
  }
} finally {await browser?.close();await server.close();await rm(cache,{recursive:true,force:true})}
