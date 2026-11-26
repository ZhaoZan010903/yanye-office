param([string]$OutputDirectory=(Join-Path ([IO.Path]::GetTempPath()) ('yanye-motion-'+[guid]::NewGuid())))
$ErrorActionPreference='Stop'
if (Test-Path -LiteralPath $OutputDirectory) {throw '请使用全新的测试目录。'}
$folder=(New-Item -ItemType Directory -Path $OutputDirectory).FullName
$file=Join-Path $folder '段落路径校样.pptx'
$paperPath='M 0 0 C 0.12 -0.25 0.24 -0.25 0.35 0 L 0.45 0.06 E'

function Use-Presentation([string]$program,[bool]$create,[scriptblock]$work) {
  $existing=@((Get-Process).Id)
  $app=New-Object -ComObject $program
  $owned=$false
  try {
    if(!('YanYeMotionWindow' -as [type])) {
      Add-Type 'using System; using System.Runtime.InteropServices; public static class YanYeMotionWindow { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid); }'
    }
    [uint32]$processId=0
    if($app.Hwnd){[void][YanYeMotionWindow]::GetWindowThreadProcessId([IntPtr]$app.Hwnd,[ref]$processId)}
    $owned=($processId -gt 0 -and $processId -notin $existing -and $app.Presentations.Count -eq 0)
    if($create){$deck=$app.Presentations.Add(0)} else {$deck=$app.Presentations.Open($file,0,0,0)}
    try {& $work $deck} finally {$deck.Close()}
  } finally {
    if($owned -and $app.Presentations.Count -eq 0){$app.Quit()}
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
  }
}
Use-Presentation 'KWPP.Application' $true {
  param($deck)
  $slide=$deck.Slides.Add(1,12)
  $textbox=$slide.Shapes.AddTextbox(1,60,60,400,210)
  $textbox.TextFrame.TextRange.Text="起草`r复核`r归档"
  [void]$slide.TimeLine.MainSequence.AddEffect($textbox,10,2,1)
  $circle=$slide.Shapes.AddShape(9,80,330,40,40)
  $circle.Fill.ForeColor.RGB=0x9900d4
  $circle.Line.Visible=0
  $motion=$slide.TimeLine.MainSequence.AddEffect($circle,149,0,1)
  $motion.Behaviors.Item(1).MotionEffect.Path=$paperPath
  $motion.Timing.Duration=1.25
  $deck.SaveAs($file,24)
}
node (Join-Path $PSScriptRoot 'slides-build-motion.mjs') $file
if($LASTEXITCODE){throw '砚页编辑或放映失败。'}
foreach($program in 'PowerPoint.Application','KWPP.Application'){
  Use-Presentation $program $false {
    param($deck)
    $seq=$deck.Slides.Item(1).TimeLine.MainSequence
    if($seq.Count -ne 4){throw "$program 未读出三段文字和一条路径。"}
    foreach($i in 1..3){$e=$seq.Item($i)
      if($e.Paragraph -ne $i -or $e.EffectInformation.BuildByLevelEffect -ne 2){throw "$program 段落映射丢失。"}
    }
    $effect=$seq.Item(4)
    if($effect.Behaviors.Item(1).MotionEffect.Path -notmatch 'C .*L 0[.,]47\d* 0[.,]06'){throw "$program 曲线或末段位移不符。"}
    if($program -eq 'PowerPoint.Application') {
      $effect.Timing.Duration=1.5
    } else {
      if([Math]::Abs($effect.Timing.Duration-1.5) -gt .01){throw 'WPS 未读到 PowerPoint 的改动。'}
      $effect.Timing.TriggerDelayTime=.125
    }
    $deck.Save()
    "$program 三段点击和曲线路径读回，已在原路径保存。"
  }
}
node (Join-Path $PSScriptRoot 'slides-build-motion.mjs') $file --verify
if($LASTEXITCODE){throw '原应用保存后，砚页回读或放映失败。'}
Use-Presentation 'PowerPoint.Application' $false {
  param($deck)
  $movie=Join-Path $folder 'PowerPoint.mp4'
  $deck.CreateVideo($movie,$false,9,480,15,75)
  $watch=[Diagnostics.Stopwatch]::StartNew()
  do {Start-Sleep -Milliseconds 500} while($deck.CreateVideoStatus -in @(0,1,2) -and $watch.Elapsed.TotalSeconds -lt 90)
  if($deck.CreateVideoStatus -ne 3 -or !(Test-Path -LiteralPath $movie)){throw 'PowerPoint 未完成放映视频导出。'}
}
node (Join-Path $PSScriptRoot 'slides-motion-video.mjs') (Join-Path $folder 'PowerPoint.mp4')
if($LASTEXITCODE){throw '原生放映视频逐帧核对失败。'}
"原应用往返校样和放映视频：$folder"
