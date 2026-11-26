param([Parameter(Mandatory=$true)][string]$File)
$ErrorActionPreference='Stop'
if([IO.Path]::GetFileName($File) -ne '演示功能区校样.pptx'){throw '仅操作专项测试生成的文件。'}
Add-Type 'using System; using System.Runtime.InteropServices; public static class YanYeRibbonWindow { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid); }'
foreach($program in 'KWPP.Application','PowerPoint.Application'){
  $before=@((Get-Process).Id)
  $app=New-Object -ComObject $program
  $owned=$false
  try {
    [uint32]$appProcess=0
    if($app.Hwnd){[void][YanYeRibbonWindow]::GetWindowThreadProcessId([IntPtr]$app.Hwnd,[ref]$appProcess)}
    $owned=$appProcess -gt 0 -and $appProcess -notin $before -and $app.Presentations.Count -eq 0
    $deck=$app.Presentations.Open($File,0,0,0)
    try {
      $slide=$deck.Slides.Item(1)
      $body=$slide.Shapes.Item('YanYe columns body').TextFrame.TextRange
      $box=$slide.Shapes.Item('YanYe text box').TextFrame.TextRange
      $shape=$slide.Shapes.Item('YanYe shape')
      if($body.Font.Name -ne 'Georgia' -or !$body.Font.Underline -or $body.ParagraphFormat.Alignment -ne 3 -or !$box.Font.Italic){throw "$program 文本格式不一致。"}
      if([Math]::Abs($shape.Left-($deck.PageSetup.SlideWidth-$shape.Width)/2) -gt .05 -or [Math]::Abs($shape.Top+$shape.Height-$deck.PageSetup.SlideHeight) -gt .05){throw "$program 的形状位置不一致。"}
      $seq=$slide.TimeLine.MainSequence
      if($seq.Count -ne 3 -or $seq.Item(1).Paragraph -ne 1 -or $seq.Item(2).Paragraph -ne 2 -or $seq.Item(3).Behaviors.Item(1).MotionEffect.Path -notmatch 'C'){throw "$program 段落动画或曲线丢失。"}
      if($program -eq 'KWPP.Application'){
        if($body.Font.Size -ne 31){throw 'WPS 打开的字号不一致。'}
        $body.Font.Size=32
      } else {
        if($body.Font.Size -ne 32){throw 'PowerPoint 未读到 WPS 的改动。'}
        $box.Font.Bold=-1
      }
      $deck.Save()
      "$program 格式、位置和三步动画回读成功，已编辑同一份 PPTX 并保存。"
    } finally {$deck.Close()}
  } finally {
    if($owned -and $app.Presentations.Count -eq 0){$app.Quit()}
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
  }
}
