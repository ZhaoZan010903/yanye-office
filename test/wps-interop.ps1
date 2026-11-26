param()
$ErrorActionPreference = 'Stop'
$sampleDir = Join-Path ([IO.Path]::GetTempPath()) ('yanye-wps-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path $sampleDir
Push-Location (Join-Path $PSScriptRoot '..')
try {
  @'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeDocx } from './src/modules/word-docx.js'
import { writeXlsx } from './src/modules/spreadsheet-xlsx.js'
import { newSheet } from './src/modules/spreadsheet.js'
const dir = process.argv[2]
const marks = [{type:'bold'}, {type:'wordStyle', attrs:{font:'宋体', latinFont:'Arial', size:16, highlight:'yellow'}}]
const doc = {type:'doc', content:[{type:'paragraph', attrs:{spaceAfter:12}, content:[{type:'text', text:'预算 Budget', marks}]}]}
const sheet = newSheet('预算')
sheet.cells = {A1:'4800', A2:'2400', B1:'=SUM(A1:A2)'}
sheet.styles = {B1:{font:'Arial', size:16, bold:true, underline:'single', vertical:'middle'}}
await writeFile(join(dir,'sample.docx'), Buffer.from(await writeDocx({doc}), 'base64'))
await writeFile(join(dir,'sample.xlsx'), Buffer.from(await writeXlsx({sheets:[sheet]}), 'base64'))
'@ | node --input-type=module - $sampleDir
  if ($LASTEXITCODE -ne 0) { throw '导出测试文件失败' }

  # WPS may reuse a running office instance. Only close our own read-only samples.
  $writer = New-Object -ComObject KWPS.Application
  try {
    $doc = $writer.Documents.Open((Join-Path $sampleDir 'sample.docx'), $false, $true)
    try {
      $run = $doc.Range(0, 9)
      if ($run.Text -ne '预算 Budget' -or $run.Font.NameFarEast -notin '宋体','SimSun' -or $run.Font.Size -ne 16 -or !$run.Font.Bold -or $run.Font.NameAscii -ne 'Arial' -or $run.HighlightColorIndex -ne 7 -or $doc.Paragraphs.Item(1).SpaceAfter -ne 12) {
        throw "WPS 文字未能还原测试格式。文字=$($run.Text) 西文=$($run.Font.NameAscii) 字号=$($run.Font.Size) 高亮=$($run.HighlightColorIndex)"
      }
      Write-Output "WPS 文字通过。中文字体 $($run.Font.NameFarEast)，西文字体 $($run.Font.NameAscii)，16 磅、加粗、黄色高亮、段后 12 磅。"
    } finally { $doc.Close(0) }
  } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($writer) }

  $spreadsheets = New-Object -ComObject KET.Application
  try {
    $book = $spreadsheets.Workbooks.Open((Join-Path $sampleDir 'sample.xlsx'), 0, $true)
    try {
      $cell = $book.Worksheets.Item(1).Range('B1')
      if ($cell.Formula -ne '=SUM(A1:A2)' -or $cell.Value2 -ne 7200 -or $cell.Font.Name -ne 'Arial' -or $cell.Font.Size -ne 16 -or !$cell.Font.Bold -or $cell.Font.Underline -ne 2 -or $cell.VerticalAlignment -ne -4108) { throw 'WPS 表格读回公式或格式有误' }
      Write-Output 'WPS 表格通过。公式和值 7200、字体、字号、加粗、下划线与垂直居中。'
    } finally { $book.Close($false) }
  } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($spreadsheets) }
} finally {
  Pop-Location
  $target = (Resolve-Path -LiteralPath $sampleDir).Path
  if ([IO.Path]::GetDirectoryName($target) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and [IO.Path]::GetFileName($target).StartsWith('yanye-wps-')) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}
