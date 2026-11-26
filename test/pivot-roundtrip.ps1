param([string]$OutputDirectory=(Join-Path ([IO.Path]::GetTempPath()) ('yanye-pivot-'+[guid]::NewGuid())))
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputDirectory){throw '请提供全新目录以生成测试工作簿。'}
$d=(New-Item -ItemType Directory -Path $OutputDirectory).FullName
$file=Join-Path $d '销售汇总.xlsx'
if(!('PivotTestOwner' -as [type])) {Add-Type 'using System; using System.Runtime.InteropServices; public static class PivotTestOwner{[DllImport("user32")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint id);}'}
function Use-Office($program,[scriptblock]$action) {
  $existing=@((Get-Process).Id);$app=New-Object -ComObject $program;$owned=$false
  try{
    try{[uint32]$instanceId=0;[void][PivotTestOwner]::GetWindowThreadProcessId([IntPtr]$app.Hwnd,[ref]$instanceId);$owned=($instanceId -gt 0 -and $instanceId -notin $existing -and $app.Workbooks.Count -eq 0)}catch{}
    & $action $app
  } finally{if($owned -and $app.Workbooks.Count -eq 0){$app.Quit()}}
}
function Get-Total($pivot) {$r=$pivot.TableRange2;return $r.Cells.Item($r.Rows.Count,$r.Columns.Count).Value2}
function Assert-Report($book,$expected,$selected) {
  $pt=$book.Worksheets('报告').PivotTables('SalesPivot')
  if($pt.PivotFields('区域').Orientation -ne 1 -or $pt.PivotFields('区域').Position -ne 1 -or
    $pt.PivotFields('城市').Orientation -ne 1 -or $pt.PivotFields('城市').Position -ne 2 -or
    $pt.PivotFields('季度').Orientation -ne 2){throw '层级或列字段改变'}
  $sc=$book.SlicerCaches.Item(1)
  if($sc.Slicers.Count -ne 1 -or $sc.Slicers.Item(1).Name -ne 'SellerFilter' -or !( $sc.SlicerItems.Item($selected).Selected)){throw '切片器或选中状态改变'}
  if((Get-Total $pt) -ne $expected){throw ('报表总计不同 '+(Get-Total $pt)+' 应为 '+$expected)}
}
Use-Office 'Excel.Application' {param($app)
  $b=$app.Workbooks.Add()
  try{
    $ws=$b.Worksheets(1);$ws.Name='数据'
    $rows=@(@('区域','城市','季度','销售','人员'),@('东部','上海','Q1',20,'甲'),@('东部','苏州','Q1',15,'乙'),@('东部','上海','Q2',30,'乙'),@('西部','成都','Q1',42,'甲'),@('西部','成都','Q2',21,'乙'))
    for($r=0;$r -lt $rows.Count;$r++){for($c=0;$c -lt $rows[0].Count;$c++){$ws.Cells.Item($r+1,$c+1).Formula=[string]$rows[$r][$c]}}
    $report=$b.Worksheets.Add();$report.Name='报告'
    $pt=$b.PivotCaches().Create(1,"'数据'!R1C1:R6C5",6).CreatePivotTable($report.Range('A1'),'SalesPivot')
    $pt.PivotFields('区域').Orientation=1;$pt.PivotFields('城市').Orientation=1;$pt.PivotFields('季度').Orientation=2
    $null=$pt.AddDataField($pt.PivotFields('销售'),'销售总额',-4157);$pt.RowAxisLayout(1)
    $sc=$b.SlicerCaches.Add2($pt,'人员')
    $null=$sc.Slicers.Add($report,[Type]::Missing,'SellerFilter','人员',30,440,118,134)
    $sc.SlicerItems.Item('乙').Selected=$false
    Assert-Report $b 62 '甲'
    $b.SaveAs($file,51)
  } finally{$b.Close($false)}
}
Use-Office 'KET.Application' {param($app)
  $b=$app.Workbooks.Open($file,0,$false)
  try{
    Assert-Report $b 62 '甲'
    $b.Worksheets('数据').Range('D3').Formula='18'
    $null=$b.Worksheets('报告').PivotTables(1).RefreshTable()
    $b.Save()
  } finally{$b.Close($false)}
}
Push-Location (Join-Path $PSScriptRoot '..')
try{node test/pivot-workspace.mjs $file;if($LASTEXITCODE -ne 0){throw '砚页界面编辑失败'}}finally{Pop-Location}
Use-Office 'KET.Application' {param($app)
  $b=$app.Workbooks.Open($file,0,$false)
  try{
    Assert-Report $b 76 '乙'
    $pt=$b.Worksheets('报告').PivotTables(1);$b.Worksheets('数据').Range('D6').Formula='23'
    $null=$pt.RefreshTable();Assert-Report $b 78 '乙';$b.Save()
  } finally{$b.Close($false)}
}
Use-Office 'Excel.Application' {param($app)
  $b=$app.Workbooks.Open($file,0,$false)
  try{
    Assert-Report $b 78 '乙'
    $pt=$b.Worksheets('报告').PivotTables(1);$b.SlicerCaches.Item(1).ClearManualFilter()
    $null=$pt.RefreshTable();Assert-Report $b 140 '甲';$b.Save()
  }finally{$b.Close($false)}
}
Use-Office 'KET.Application' {param($app)
  $b=$app.Workbooks.Open($file,0,$true)
  try{Assert-Report $b 140 '乙'}finally{$b.Close($false)}
}
Write-Output "同一路径 Excel → WPS → 砚页 → WPS → Excel → WPS 已通过。62 → 76 → 78 → 140。$file"
