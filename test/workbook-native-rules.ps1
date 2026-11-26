param([string[]]$Applications=@('Excel.Application','KET.Application'))
$ErrorActionPreference='Stop'
$workspace=Join-Path ([IO.Path]::GetTempPath()) ('yanye-grid-native-'+[guid]::NewGuid())
$null=New-Item -ItemType Directory -Path $workspace
$previous=$env:YANYE_NATIVE_WORKBOOK
Push-Location (Join-Path $PSScriptRoot '..')
try {
  foreach($progId in $Applications) {
    $stem=Join-Path $workspace $progId
    $env:YANYE_NATIVE_WORKBOOK=$stem
    $app=New-Object -ComObject $progId
    try {
      $book=$app.Workbooks.Add()
      try {
        $sheet=$book.Worksheets.Item(1)
        $sheet.Range('A1').Formula='状态';$sheet.Range('B1').Formula='收入';$sheet.Range('C1').Formula='成本'
        $sheet.Range('A2').Formula='完成';$sheet.Range('B2').Formula='32';$sheet.Range('C2').Formula='15'
        $sheet.Range('A3').Formula='计划';$sheet.Range('B3').Formula='24';$sheet.Range('C3').Formula='-12'
        $sheet.Range('D2').Formula='=SUMIFS(B2:B3,A2:A3,"完成",C2:C3,">0")'
        $sheet.Range('E2').Formula='=COUNTIFS(A2:A3,"计划",C2:C3,"<0")'
        $sheet.Range('F2').Formula='=IFERROR(VLOOKUP("完成",A2:C3,3,FALSE),0)'
        $sheet.Range('G2').Formula='=IFERROR(VLOOKUP("未录入",A2:C3,3,FALSE),"缺项")'
        $sheet.Range('A2:A3').Validation.Add(3,1,1,'计划,完成')
        $condition=$sheet.Range('B2:B3').FormatConditions.Add(1,5,'30')
        $condition.Interior.Color=65535
        $null=$sheet.Range('A1:C3').AutoFilter(1,'完成')
        $chart=$sheet.ChartObjects().Add(50,50,400,220).Chart
        $chart.ChartType=57
        $chart.SetSourceData($sheet.Range('A1:C3'),2)
        $book.SaveAs($stem+'.xlsx',51)
      } finally {$book.Close($false)}
      @'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {readXlsx,writeXlsx} from './src/modules/spreadsheet-xlsx.js'
import {evaluator} from './src/modules/spreadsheet.js'
const path=process.env.YANYE_NATIVE_WORKBOOK
const sheets=await readXlsx((await fs.readFile(path+'.xlsx')).toString('base64'))
const s=sheets[0]
assert.deepEqual(s.chart.series,[1,2])
assert.equal(s.validations[0].formulae[0],'"计划,完成"')
assert.equal(s.conditions[0].rules[0].formulae[0],'30')
assert.deepEqual(s.autoFilter.columns[0],['完成'])
s.chart.palette='ocean'
s.chart.colors=null
s.cells.B2='70'
const display=evaluator({sheets})
assert.deepEqual(['D2','E2','F2','G2'].map(ref=>display(s,ref)),[70,1,15,'缺项'])
await fs.writeFile(path+'-edited.xlsx',Buffer.from(await writeXlsx({sheets}),'base64'))
'@ | node --input-type=module
      if($LASTEXITCODE -ne 0){throw '砚页处理原生工作簿失败。'}
      $book=$app.Workbooks.Open($stem+'-edited.xlsx',0,$true)
      try {
        $sheet=$book.Worksheets.Item(1)
        $chart=$sheet.ChartObjects(1).Chart
        if($chart.ChartType -ne 57 -or $chart.SeriesCollection().Count -ne 2 -or !$chart.HasLegend){throw '原生图表类型、系列或图例有误。'}
        if($chart.SeriesCollection(1).Formula -notmatch '\$B\$2:\$B\$3' -or $chart.SeriesCollection(1).Format.Fill.ForeColor.RGB -ne 9528633){throw '原生图表数据来源或配色有误。'}
        if($sheet.Range('A2').Validation.Formula1 -ne '计划,完成' -or $sheet.Range('B2').FormatConditions.Item(1).Formula1 -notmatch '30'){throw '原生数据验证或条件格式有误。'}
        if($sheet.Range('B2').Value2 -ne 70 -or $sheet.Range('A2').EntireRow.Hidden -or !$sheet.Range('A3').EntireRow.Hidden){throw '筛选或单元格编辑有误。'}
        $app.Calculate()
        if($sheet.Range('D2').Value2 -ne 70 -or $sheet.Range('E2').Value2 -ne 1 -or $sheet.Range('F2').Value2 -ne 15 -or $sheet.Range('G2').Value2 -ne '缺项'){throw '原生预算与查找公式的重算结果有误。'}
        Write-Output ($progId+' 工作簿创建、砚页修改、原程序核验通过。')
      } finally {$book.Close($false)}
    } finally {if($app.Workbooks.Count -eq 0){$app.Quit()}}
  }
} finally {
  $env:YANYE_NATIVE_WORKBOOK=$previous
  Pop-Location
  $resolved=(Resolve-Path -LiteralPath $workspace).Path
  if([IO.Path]::GetDirectoryName($resolved) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and [IO.Path]::GetFileName($resolved).StartsWith('yanye-grid-native-')){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
