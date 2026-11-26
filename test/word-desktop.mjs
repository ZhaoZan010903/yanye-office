// Run on Windows with Microsoft Word installed: node test/word-desktop.mjs [YanYe.exe]
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron } from 'playwright'
import { writeDocx } from '../src/modules/word-docx.js'

const project = resolve(fileURLToPath(new URL('../',import.meta.url)))
const temp = await mkdtemp(join(tmpdir(),'yanye-word-desktop-'))
const profile = join(temp,'profile'), source=join(temp,'from-word.docx'), copy=join(temp,'from-yanye.docx'), pdf=join(temp,'print.pdf')
const executablePath = process.argv[2] ? resolve(process.argv[2]) : createRequire(import.meta.url)('electron')
const par=text=>({type:'paragraph',content:[{type:'text',text}]})
const cell=text=>({type:'tableCell',content:[par(text)]})
const sample={type:'doc',content:[
  {type:'heading',attrs:{level:1},content:[{type:'text',text:'Local Office'}]},
  par('Review budget'),{type:'table',content:[{type:'tableRow',content:[cell('Item'),cell('Value')]}]},
  {type:'pageBreak'},par('Second page'),{type:'paragraph',content:[{type:'image',attrs:{width:36,height:36,alt:'Icon',
    src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6ioAAAAASUVORK5CYII='}}]}]}

function nativeWord(action,progId='Word.Application') {
  const script=[
    "$ErrorActionPreference = 'Stop'",
    "$word = $null; $doc = $null",
    "try {",
    "$word = New-Object -ComObject "+progId,
    "$word.Visible = $false; $word.DisplayAlerts = 0; $word.AutomationSecurity = 3",
    ...action,
    "} finally { if ($doc) { $doc.Close(0) }; try {if ($word -and $word.Documents.Count -eq 0) { $word.Quit(0) }} catch {if($_.Exception.HResult -ne -2147023174){throw}} }"
  ].join('\n')
  return execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {windowsHide:true,encoding:'utf8',timeout:60000,env:{...process.env,YANYE_TEST_DIR:temp}}).trim()
}

async function readOutput(path) {
  const end=Date.now()+12000
  for (;;) {
    try {return await readFile(path)} catch(e) {if (e.code!=='ENOENT' || Date.now()>end) throw e; await delay(100)}
  }
}

let app
try {
  await writeFile(join(temp,'seed.docx'),Buffer.from(await writeDocx({doc:sample}),'base64'))
  nativeWord([
    "$doc = $word.Documents.OpenNoRepairDialog((Join-Path $env:YANYE_TEST_DIR 'seed.docx'), $false, $true, $false)",
    "if ($doc.Tables.Count -ne 1 -or $doc.ComputeStatistics(2) -ne 2 -or $doc.InlineShapes.Count -ne 1) {throw 'Word failed to read editable content'}",
    "$heading = $doc.Paragraphs.Item(1).Range",
    "$heading.Font.NameAscii = 'Cambria'; $heading.Font.NameFarEast = 'KaiTi'; $heading.HighlightColorIndex = 4; $heading.ParagraphFormat.SpaceAfter = 18",
    "$comment=$doc.Comments.Add($doc.Range(0,5),'Original review'); $comment.Author='Reviewer'",
    "$section=$doc.Sections.Item(1); $section.Headers.Item(1).Range.Text='Budget header'; $range=$section.Footers.Item(1).Range; $range.Collapse(1); $null=$section.Footers.Item(1).Range.Fields.Add($range,33)",
    "$doc.SaveAs2((Join-Path $env:YANYE_TEST_DIR 'from-word.docx'),16)",
  ])
  app=await _electron.launch({executablePath,args:process.argv[2]?[]:[project],env:{...process.env,YANYE_PROFILE:profile}})
  const page=await app.firstWindow()
  page.setDefaultTimeout(9000)
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.context().setOffline(true)
  await app.evaluate(({dialog},files)=>{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[files.source]})
    dialog.showSaveDialog=async(_w,opts)=>({canceled:false,filePath:opts.defaultPath.endsWith('.pdf')?files.pdf:files.copy})
  },{source,copy,pdf})
  const button=name=>page.getByRole('button',{name,exact:true})
  await button('打开本地文件').click()
  const body=page.getByRole('textbox',{name:'Word 文档正文'})
  await body.waitFor()
  await body.getByRole('heading',{name:'Local Office'}).waitFor()
  const heading=body.getByRole('heading',{name:'Local Office'})
  const importedRun=heading.locator('[data-latin-font="Cambria"]')
  await importedRun.first().waitFor()
  assert.equal(await importedRun.first().getAttribute('data-highlight'),'green')
  assert.equal(await heading.evaluate(el=>el.style.marginBottom),'18pt')
  assert.equal(await body.locator('table').count(),1)
  assert.equal(await body.locator('img[src^="data:image/"]').count(),1)
  assert.equal(await body.locator('[data-word-page-break]').count(),1)
  await button('插入').click()
  await button('页眉页脚').click()
  const band=page.getByRole('region',{name:'页眉页脚设置'})
  assert.equal(await band.getByLabel('默认页页眉').inputValue(),'Budget header')
  await band.getByLabel('默认页页眉').fill('Reviewed header')
  await band.getByLabel('位置').selectOption('footer')
  const footer=band.getByLabel('默认页页脚')
  assert.match(await footer.inputValue(),/\{\{PAGE\}\}/)
  await footer.fill('Page {{PAGE}} of ')
  await footer.press('End')
  await button('插入总页数').click()
  await button('审阅').click()
  const review=page.getByRole('region',{name:'文档批注'})
  const originalComment=review.getByRole('listitem').filter({hasText:'Original review'})
  await originalComment.getByRole('button',{name:'定位'}).click()
  assert.equal(await page.evaluate(()=>window.getSelection().toString()),'Local')
  await review.getByLabel('批注署名').fill('Editor')
  await review.getByLabel('批注内容').fill('Checked quantity')
  await review.getByRole('button',{name:'添加批注'}).click()
  await originalComment.getByRole('button',{name:'删除批注'}).click()
  assert.equal(await review.getByRole('listitem').count(),1)
  await button('开始').click()
  await button('查找替换').click()
  await page.getByLabel('查找文字').fill('Review budget')
  await page.getByLabel('替换文字').fill('Approved budget')
  await button('全部替换').click()
  await body.getByText('Approved budget',{exact:true}).waitFor()
  await page.getByLabel('查找文字').fill('Approved budget')
  await button('下一处').click()
  await page.getByLabel('字体',{exact:true}).selectOption('FangSong')
  await page.getByLabel('西文字体',{exact:true}).selectOption('__custom')
  await page.getByRole('textbox',{name:'西文字体名称'}).fill('Arial')
  await button('应用字体').click()
  await page.getByLabel('字号',{exact:true}).selectOption('15')
  await page.getByLabel('荧光标记').selectOption('yellow')
  await button('上标').click()
  await page.getByRole('tab',{name:'页面',exact:true}).click()
  await page.getByLabel('首行缩进').selectOption('2')
  await page.getByLabel('段前间距').selectOption('6')
  await page.getByLabel('段后间距').selectOption('12')
  await page.getByLabel('纸张大小').selectOption('Letter')
  await page.getByLabel('页边距',{exact:true}).selectOption('12.7')
  await button('另存为').click()
  await readOutput(copy)
  await button('导出 PDF').click()
  const printed=(await readOutput(pdf)).toString('latin1')
  assert.equal((printed.match(/\/Type\s*\/Page\b/g)||[]).length,2)
  assert.match(printed,/\/MediaBox\s*\[\s*0\s+0\s+612(?:\.0*)?\s+792(?:\.0*)?\s*\]/)
  assert.deepEqual(errors,[])
  const actual=nativeWord([
    "$doc = $word.Documents.OpenNoRepairDialog((Join-Path $env:YANYE_TEST_DIR 'from-yanye.docx'), $false, $true, $false)",
    "if (!$doc.Content.Text.Contains('Approved budget') -or $doc.Tables.Count -ne 1 -or $doc.InlineShapes.Count -ne 1 -or $doc.ComputeStatistics(2) -ne 2) {throw 'Native Word round trip failed'}",
    "if ([Math]::Abs($doc.PageSetup.LeftMargin - 36) -gt 1 -or [Math]::Abs($doc.PageSetup.PageWidth - 612) -gt 1) {throw 'Paper settings changed'}",
    "$s=$doc.Sections.Item(1); $fields=@($s.Footers.Item(1).Range.Fields|ForEach-Object {$_.Type}); if($s.Headers.Item(1).Range.Text.Trim() -ne 'Reviewed header' -or $fields -notcontains 33 -or $fields -notcontains 26){throw 'Header or live page fields lost'}",
    "if($doc.Comments.Count -ne 1 -or $doc.Comments.Item(1).Scope.Text -ne 'Local' -or $doc.Comments.Item(1).Author -ne 'Editor' -or $doc.Comments.Item(1).Range.Text.Trim() -ne 'Checked quantity'){throw 'Native range comment changed'}",
    "$formatted = $doc.Content.Duplicate; if (!$formatted.Find.Execute('Approved budget')) {throw 'Missing formatted text'}",
    "if ($formatted.Font.NameAscii -ne 'Arial' -or $formatted.Font.NameFarEast -notin @('仿宋','FangSong') -or $formatted.Font.Size -ne 15 -or !$formatted.Font.Superscript -or $formatted.HighlightColorIndex -ne 7) {throw ('Character format changed: '+$formatted.Font.NameAscii+' / '+$formatted.Font.NameFarEast+' / '+$formatted.Font.Size+' / '+$formatted.Font.Superscript+' / '+$formatted.HighlightColorIndex)}",
    "if ($formatted.ParagraphFormat.SpaceBefore -ne 6 -or $formatted.ParagraphFormat.SpaceAfter -ne 12 -or [Math]::Abs($formatted.ParagraphFormat.CharacterUnitFirstLineIndent-2) -gt .05) {throw 'Paragraph formatting changed'}",
    "Write-Output ('Word ' + $word.Version + ', pages ' + $doc.ComputeStatistics(2) + ', tables ' + $doc.Tables.Count + ', images ' + $doc.InlineShapes.Count)",
  ])
  console.log(actual + '. DOCX round trip and two-page Letter PDF passed.')
  if(process.env.YANYE_WPS_INTEROP==='1') {
    console.log(nativeWord([
      "$doc = $word.Documents.Open((Join-Path $env:YANYE_TEST_DIR 'from-yanye.docx'), $false, $true)",
      "if($doc.Comments.Count -ne 1 -or $doc.Comments.Item(1).Scope.Text -ne 'Local' -or $doc.Comments.Item(1).Author -ne 'Editor' -or $doc.Comments.Item(1).Range.Text.Trim() -ne 'Checked quantity'){throw 'WPS range comment changed'}",
      "Write-Output 'WPS Writer opened the native review comment and confirmed its anchor, author, and body.'",
    ],'KWPS.Application'))
  }
} finally {
  if (app) await app.close().catch(()=>{})
  if (dirname(temp)===tmpdir() && basename(temp).startsWith('yanye-word-desktop-')) await rm(temp,{recursive:true,force:true,maxRetries:5}).catch(e=>console.warn('Fixture cleanup: '+e.message))
}
