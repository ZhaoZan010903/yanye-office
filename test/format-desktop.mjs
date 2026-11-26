import assert from 'node:assert/strict'
import {copyFile,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import ExcelJS from 'exceljs'
import pptxgen from 'pptxgenjs'
import Zip from 'jszip'
import {writeDocx} from '../src/modules/word-docx.js'
import {desktopSession,eventually} from './desktop-session.mjs'

// Exercise the installed application's file center, converter and disk revision checks.
const executable=resolve(process.argv[2])
const reuse=process.argv[3]
const temp=await mkdtemp(join(tmpdir(),'yanye-formats-'))
const profile=join(temp,'profile'), folder=join(temp,'samples')
await Promise.all([mkdir(profile),mkdir(folder)])
await writeFile(join(profile,'file-library.json'),JSON.stringify({version:1,root:folder,files:[]}))
const entry=join(folder,'欢迎.txt')
await writeFile(entry,'格式回读')
const session=desktopSession({executable,source:entry,profile,temp})
const word=await writeDocx({doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Format sample',marks:[{type:'bold'}]}]}]}})
const book=new ExcelJS.Workbook()
const sheet=book.addWorksheet('Budget')
sheet.getCell('A1').value=7
sheet.getCell('B1').value={formula:'A1*2',result:14}
const slides=new pptxgen()
slides.addSlide().addText('Format sample',{x:1,y:1,w:4,h:1,fontFace:'Arial',fontSize:18})
const modern={docx:word,xlsx:Buffer.from(await book.xlsx.writeBuffer()).toString('base64'),pptx:await slides.write({outputType:'base64'})}
const entries=[['doc','docx'],['rtf','docx'],['odt','docx'],['xls','xlsx'],['ods','xlsx'],['ppt','pptx'],['odp','pptx']]
const ole=Buffer.from('d0cf11e0a1b11ae1','hex')
try {
  const page=await session.start()
  page.setDefaultTimeout(60_000)
  await page.getByRole('button',{name:'返回文件中心',exact:true}).first().waitFor()
  const library=async (operation,...args)=>page.evaluate(([method,args])=>window.yanye.library[method](...args),[operation,args])
  const records=new Map()
  for(const [ext,target] of entries) {
    const name='Format sample.'+ext
    if(reuse) {
      if(['doc','xls','ppt'].includes(ext)) {
        await copyFile(join(reuse,name),join(folder,name))
        records.set(ext,await library('read',name))
      }
      continue
    }
    const record=await library('create','',name,modern[target])
    records.set(ext,record)
    const bytes=await readFile(join(folder,name))
    const signature=['doc','xls','ppt'].includes(ext) ? ole : Buffer.from(ext==='rtf'?'{\\rtf':'PK')
    assert.ok(bytes.subarray(0,signature.length).equals(signature),ext+' signature')
    const result=await library('readConverted',record.id,record.revision)
    assert.equal(result.extension,target)
    const archive=await Zip.loadAsync(result.content,{base64:true})
    if(target==='docx') {
      const xml=await archive.file('word/document.xml').async('string')
      assert.match(xml,/Format sample/)
      assert.match(xml,/<w:b(?:\s|\/|>)/)
    } else if(target==='xlsx') {
      const xml=await archive.file('xl/worksheets/sheet1.xml').async('string')
      assert.match(xml,/A1\*2/)
    } else {
      assert.match(await archive.file('ppt/slides/slide1.xml').async('string'),/Format sample/)
    }
    console.log(ext+' create → reopen → content verified')
  }
  const btn=(name)=>page.getByRole('button',{name,exact:true}).first()
  const uiExtensions=process.argv[4] ? [process.argv[4]] : ['doc','xls','ppt']
  for (const ext of uiExtensions) {
    console.log('Editing '+ext+' in '+folder)
    await btn('返回文件中心').click()
    await btn('本地文件夹').click()
    await page.locator('.files-table').getByRole('button',{name:'Format sample.'+ext,exact:true}).click()
    if(ext==='xls') {
      await page.locator('td[data-address="A1"]').click()
      await page.getByLabel('公式栏',{exact:true}).fill('21')
      await page.getByLabel('公式栏',{exact:true}).press('Enter')
    } else {
      let editor=page.getByLabel('Word 文档正文',{exact:true})
      if(ext==='ppt'){
        const shape=page.getByRole('button',{name:/^选择形状 Format sample/})
        await page.locator('.slides-page').first().waitFor()
        if(await shape.count()) {
          await shape.first().click()
          editor=page.getByLabel('形状文字',{exact:true})
        } else editor=page.locator('[contenteditable=true]').filter({hasText:'Format sample'}).first()
      }
      await editor.click()
      await page.keyboard.press('Control+End')
      await page.keyboard.insertText(' revised')
    }
    await btn('保存文件').click()
    await btn('备份并保存原文件').click()
    const before=records.get(ext)
    const disk=await eventually(async()=>{
      const current=await library('readRecent',before.id)
      return current.revision!==before.revision && current
    },ext+' did not save')
    const converted=await library('readConverted',disk.id,disk.revision)
    const zip=await Zip.loadAsync(converted.content,{base64:true})
    const part={doc:'word/document.xml',xls:'xl/worksheets/sheet1.xml',ppt:'ppt/slides/slide1.xml'}[ext]
    const xml=await zip.file(part).async('string')
    assert.match(xml,ext==='xls'?/<v>21<\/v>/:/revised/)
    if(ext==='xls') assert.match(xml,/A1\*2/)
    await assert.rejects(library('readConverted',disk.id,before.revision),/变化/)
    console.log(ext+' desktop edit → save original → read back passed')
  }
  console.log(folder)
} finally {
  await session.stop()
}
