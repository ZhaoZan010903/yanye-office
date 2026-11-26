param([string]$EvidenceDirectory)
$ErrorActionPreference='Stop'
if(!$EvidenceDirectory){$EvidenceDirectory=Join-Path ([IO.Path]::GetTempPath()) ('yanye-large-grid-'+[guid]::NewGuid())}
$null=New-Item -ItemType Directory -Force -Path $EvidenceDirectory
$EvidenceDirectory=(Resolve-Path -LiteralPath $EvidenceDirectory).Path
$file=Join-Path $EvidenceDirectory 'large-grid.xlsx'
if(Test-Path -LiteralPath $file){throw '测试目录已有同名工作簿，请选择新的目录。'}
$rea=Join-Path $env:LOCALAPPDATA 'Programs/REA/bin/rea.cmd'
function Inspect-Sample($stage) {
  $report=Join-Path $EvidenceDirectory ($stage+'.json')
  & $rea inspect-artifact $file --format json | Set-Content -LiteralPath $report -Encoding utf8
  if($LASTEXITCODE){throw ('REA 未能检查 '+$stage)}
}
if(!("YanYeGridWindow" -as [type])) {Add-Type 'using System; using System.Runtime.InteropServices; public static class YanYeGridWindow {[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);}' }
function Open-Sample($progId,$work) {
  $before=@((Get-Process).Id)
  $app=New-Object -ComObject $progId
  $owned=$false
  try {[uint32]$appId=0;[void][YanYeGridWindow]::GetWindowThreadProcessId([IntPtr]$app.Hwnd,[ref]$appId);$owned=$appId -gt 0 -and $appId -notin $before -and $app.Workbooks.Count -eq 0}catch{}
  $alerts=$app.DisplayAlerts
  try {
    $app.DisplayAlerts=$false
    $book=$app.Workbooks.Open($file,0,$false)
    try { & $work $book $book.Worksheets.Item(1) } finally {$book.Close($false)}
  } finally {$app.DisplayAlerts=$alerts; if($owned -and $app.Workbooks.Count -eq 0){$app.Quit()}}
}
Push-Location (Join-Path $PSScriptRoot '..')
try {
  node test/sheet-large-preview.mjs --seed $file
  if($LASTEXITCODE){throw '创建大表样张失败。'}
  Inspect-Sample '01-yanye'
  Open-Sample 'Excel.Application' {param($book,$sheet)
    if($sheet.Range('BTT100000').Text -ne '远端数据'){throw 'Excel 远端单元格读取有误。'}
    $sheet.Range('BTT100000').Formula='Excel 编辑'
    $sheet.Range('C2').Formula='=A2+B2'
    $book.Save()
  }
  Inspect-Sample '02-excel'
  Open-Sample 'KET.Application' {param($book,$sheet)
    if($sheet.Range('BTT100000').Text -ne 'Excel 编辑' -or $sheet.Range('C2').Value2 -ne 21){throw 'WPS 未读回 Excel 的修改。'}
    if($sheet.PageSetup.Orientation -ne 2 -or $sheet.PageSetup.PrintTitleRows -notmatch '1:\$?1'){throw 'WPS 打印标题或纸张方向有误。'}
    $sheet.Range('BTT100000').Formula='WPS 编辑'
    $book.Save()
  }
  Inspect-Sample '03-wps'
  node test/sheet-large-preview.mjs --roundtrip $file
  if($LASTEXITCODE){throw '砚页读取原生修改或原路径写回失败。'}
  Inspect-Sample '04-yanye'
  foreach($id in @('Excel.Application','KET.Application')){
    Open-Sample $id {param($book,$sheet)
      if($sheet.Range('BTT100000').Text -ne '砚页回存' -or !$sheet.Range('BTT100000').Font.Italic -or $sheet.Range('BTT100000').Font.Color -ne 8874){throw ($id+' 远端数据或格式有误。')}
      if($sheet.PageSetup.Orientation -ne 2 -or $sheet.PageSetup.PrintArea -notmatch '\$A\$1:\$D\$132' -or !$sheet.PageSetup.PrintGridlines){throw ($id+' 打印区域、方向或网格格式有误。')}
      if($sheet.Range('A1').Font.Size -ne 14 -or !$sheet.Range('A1').Font.Bold -or $sheet.Range('C2').Value2 -ne 21){throw ($id+' 打印标题字体或公式有误。')}
      Write-Output ($id+' 原路径往返通过：BTT100000、字体、公式、打印区域、横向、重复标题和网格。')
    }
  }
  Write-Output $EvidenceDirectory
} finally {Pop-Location}
