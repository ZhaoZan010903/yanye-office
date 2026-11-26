param([string]$OutputDirectory=(Join-Path ([IO.Path]::GetTempPath()) ('yanye-section-animation-'+[guid]::NewGuid())))
$ErrorActionPreference='Stop'
if (Test-Path -LiteralPath $OutputDirectory) { throw '请选择全新的空目录来生成样本。' }
$folder=(New-Item -ItemType Directory -Path $OutputDirectory).FullName
$types=@(1,10,22,2,61,149)
$triggers=@(1,2,3,1,1,1)

if (!('YanYeOfficeTestWindow' -as [type])) {
  Add-Type 'using System; using System.Runtime.InteropServices; public static class YanYeOfficeTestWindow { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId); }'
}
function Open-TestOffice([string]$Program,[string]$Collection) {
  $existing=@((Get-Process).Id)
  $app=New-Object -ComObject $Program
  $ownsProcess=$false
  try {
    [uint32]$officeProcessId=0
    [void][YanYeOfficeTestWindow]::GetWindowThreadProcessId([IntPtr]$app.Hwnd,[ref]$officeProcessId)
    $ownsProcess=($officeProcessId -gt 0 -and $officeProcessId -notin $existing -and $app.$Collection.Count -eq 0)
  } catch { $ownsProcess=$false }
  [pscustomobject]@{App=$app; Owned=$ownsProcess; Collection=$Collection}
}
function Close-TestOffice($session) {
  try {
    $collection=$session.Collection
    if ($session.Owned -and $session.App.$collection.Count -eq 0) { $session.App.Quit() }
  } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($session.App) }
}

$session=Open-TestOffice 'KWPS.Application' 'Documents'
$writer=$session.App
try {
  $doc=$writer.Documents.Add()
  try {
    $doc.Content.Text='第一节的目录'
    $doc.Range($doc.Content.End-1,$doc.Content.End-1).InsertBreak(2)
    $doc.Range($doc.Content.End-1,$doc.Content.End-1).Text='第二节的合同'
    $doc.Sections.Item(2).PageSetup.Orientation=1
    $doc.Sections.Item(1).Headers.Item(1).Range.Text='合同页眉'
    $doc.Sections.Item(1).Footers.Item(1).Range.Text='合同页脚'
    $doc.TrackRevisions=$true
    $doc.Range(0,1).Text='新'
    $doc.SaveAs([ref](Join-Path $folder 'native-input.docx'),[ref]16)
  } finally { $doc.Close(0) }
} finally { Close-TestOffice $session }

$session=Open-TestOffice 'KWPP.Application' 'Presentations'
$ppt=$session.App
try {
  $deck=$ppt.Presentations.Add(0)
  try {
    $slide=$deck.Slides.Add(1,12)
    for ($i=0;$i -lt $types.Length;$i++) {
      $shape=$slide.Shapes.AddTextbox(1,20,25*($i+1),140,24)
      $shape.TextFrame.TextRange.Text='OBJECT '+$types[$i]
      $effect=$slide.TimeLine.MainSequence.AddEffect($shape,$types[$i],0,$triggers[$i])
      $effect.Timing.Duration=0.75
      $effect.Timing.TriggerDelayTime=0.25
    }
    $deck.SaveAs((Join-Path $folder 'native-input.pptx'),24)
  } finally { $deck.Close() }
} finally { Close-TestOffice $session }

node (Join-Path $PSScriptRoot 'office-layout-animation.mjs') $folder
if ($LASTEXITCODE) { throw '砚页编辑器样本往返失败。' }

foreach ($program in 'KWPS.Application','Word.Application') {
  $session=Open-TestOffice $program 'Documents'
  $app=$session.App
  try {
    foreach ($name in 'native-roundtrip','edited') {
      $doc=$app.Documents.Open((Join-Path $folder "$name.docx"),$false,$true)
      try {
        if ($doc.Sections.Count -ne 2 -or $doc.Sections.Item(1).PageSetup.Orientation -ne 0 -or
            $doc.Sections.Item(2).PageSetup.Orientation -ne 1 -or $doc.Sections.Item(2).PageSetup.TextColumns.Count -ne 2) { throw "$program 分节或分栏有误" }
        if ($name -eq 'native-roundtrip' -and ($doc.Revisions.Count -ne 2 -or !$doc.TrackRevisions)) { throw "$program 修订丢失" }
        if ($name -eq 'edited' -and ($doc.Revisions.Count -ne 0 -or !$doc.Content.Text.Contains('LOCAL') -or !$doc.Content.Text.Contains('第一节'))) { throw "$program 接受或拒绝结果错误" }
        $second=$doc.Sections.Item(2)
        if (!$second.Headers.Item(1).LinkToPrevious -or !$second.Headers.Item(1).Range.Text.Contains('合同页眉') -or
            $second.Footers.Item(1).LinkToPrevious -or !$second.Footers.Item(1).Range.Text.Contains('第二节页脚')) { throw "$program 页眉和页脚的独立继承状态有误" }
      } finally { $doc.Close(0) }
    }
    $inserted=$app.Documents.Open((Join-Path $folder 'inserted-section.docx'),$false,$true)
    try {
      if ($inserted.Sections.Count -ne 3) { throw "$program 增加第三节有误" }
    } finally { $inserted.Close(0) }
  } finally { Close-TestOffice $session }
  Write-Output "$program 双节排版、修改第二节栏数、插入新节、接受和拒绝文字修订通过"
}
foreach ($program in 'KWPP.Application','PowerPoint.Application') {
  $session=Open-TestOffice $program 'Presentations'
  $app=$session.App
  try {
    foreach ($name in 'native-roundtrip','edited') {
      $deck=$app.Presentations.Open((Join-Path $folder "$name.pptx"),-1,0,0)
      try {
        $sequence=$deck.Slides.Item(1).TimeLine.MainSequence
        $expected=if ($name -eq 'edited') { @(10,10,22,2,61,149,10) } else { $types }
        if ($sequence.Count -ne $expected.Length) { throw "$program 动画个数有误" }
        for ($i=0;$i -lt $expected.Length;$i++) {
          $effect=$sequence.Item($i+1)
          $trigger=if ($i -eq 6) {1} else {$triggers[$i]}
          $duration=if ($i -eq 6) {.5} elseif ($i -eq 0 -and $name -eq 'edited') {1.25} else {.75}
          if ($effect.EffectType -ne $expected[$i] -or $effect.Timing.TriggerType -ne $trigger -or
              [math]::Abs($effect.Timing.Duration-$duration) -gt .01) { throw "$program 动画效果、触发或持续时间有误 ($i)" }
          if ($i -lt 6 -and ($effect.Shape.TextFrame.TextRange.Text -ne ('OBJECT '+$types[$i]) -or [math]::Abs($effect.Timing.TriggerDelayTime-.25) -gt .01)) { throw "$program 动画目标或延迟有误 ($i)" }
          if ($i -eq 5 -and $name -eq 'edited' -and $effect.Behaviors.Item(1).MotionEffect.Path -notmatch '0[.,]350*(?!\d)') { throw "$program 直线运动路径位移有误" }
        }
      } finally { $deck.Close() }
    }
  } finally { Close-TestOffice $session }
  Write-Output "$program 六种原生动画、目标对象、次序、持续时间和触发通过"
}
Write-Output "用于检查的独立样本目录 $folder"
