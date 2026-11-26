param([Parameter(Mandatory)][string]$File,[ValidateSet('edit','verify')][string]$Phase)
$ErrorActionPreference='Stop'
if([IO.Path]::GetFileName($File) -ne '字符母版往返.pptx'){throw '文件并非本次生成的样本。'}
Add-Type 'using System; using System.Runtime.InteropServices; public static class YanYeMasterWindow { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid); [DllImport("oleaut32.dll", PreserveSig=false)] public static extern void GetActiveObject(ref Guid clsid, IntPtr reserved,[MarshalAs(UnmanagedType.IUnknown)] out object app); }'
function ColorNumber($hex){return [Convert]::ToInt32($hex.Substring(4,2)+$hex.Substring(2,2)+$hex.Substring(0,2),16)}
foreach($program in 'KWPP.Application','PowerPoint.Application'){
  $before=@((Get-Process).Id)
  $app=$null
  if($program -eq 'KWPP.Application'){
    $clsid=[Type]::GetTypeFromProgID($program).GUID
    try{[YanYeMasterWindow]::GetActiveObject([ref]$clsid,[IntPtr]::Zero,[ref]$app)}catch{}
  }
  if(!$app){$app=New-Object -ComObject $program}
  $owned=$false
  try{
    if(($app.Path -match 'WPS Office') -ne ($program -eq 'KWPP.Application')){throw "$program 实际启动的应用不匹配：$($app.Path)"}
    [uint32]$appProcess=0
    if($app.Hwnd){[void][YanYeMasterWindow]::GetWindowThreadProcessId([IntPtr]$app.Hwnd,[ref]$appProcess)}
    $owned=$appProcess -gt 0 -and $appProcess -notin $before -and $app.Presentations.Count -eq 0
    $deck=$app.Presentations.Open($File,0,0,0)
    try{
      $slide=$deck.Slides.Item(1)
      $textBox=$slide.Shapes.Item('YanYe text box')
      $txt=$textBox.TextFrame.TextRange
      $word=$txt.Characters(4,6)
      $prefix=$txt.Characters(1,2)
      $suffix=$txt.Characters(11,2)
      $expectedSize=if($Phase -eq 'edit' -and $program -eq 'KWPP.Application'){30}else{32}
      $expectedColor=if($Phase -eq 'edit'){'AA3355'}else{'2255AA'}
      if($word.Text -ne 'Review' -or $word.Font.Name -ne 'Georgia' -or $word.Font.Size -ne $expectedSize -or $word.Font.Color.RGB -ne (ColorNumber $expectedColor)){throw "$program 字符格式不符 $($word.Text) $($word.Font.Name) $($word.Font.Size) $($word.Font.Color.RGB)。"}
      if($prefix.Font.Size -ne 22 -or $suffix.Font.Size -ne 22){throw "$program 相邻文字字号改变。"}
      $master=$slide.Design.SlideMaster
      $label=$null
      foreach($shape in $master.Shapes){if($shape.HasTextFrame -and $shape.TextFrame.HasText -and $shape.TextFrame.TextRange.Text -like '季度复核*'){$label=$shape.TextFrame.TextRange;break}}
      if(!$label -or $master.Background.Fill.ForeColor.RGB -ne (ColorNumber 'F0E8D5') -or !$deck.Slides.Item(2).FollowMasterBackground){throw "$program 母版丢失或继承中断。"}
      $w=$deck.PageSetup.SlideWidth
      $h=$deck.PageSetup.SlideHeight
      if([Math]::Abs($textBox.Left-$w*.12) -gt .1 -or [Math]::Abs($textBox.Top-$h*.45) -gt .1 -or [Math]::Abs($textBox.Width-$w*.38) -gt .1 -or [Math]::Abs($textBox.Height-$h*.15) -gt .1 -or [Math]::Abs($shape.Left-$w*.06) -gt .1 -or [Math]::Abs($shape.Top-$h*.85) -gt .1){throw "$program 对象或母版排版位置变化。"}
      if($slide.TimeLine.MainSequence.Count -ne 2){throw "$program 按段动画丢失。"}
      if($Phase -eq 'edit'){
        if($program -eq 'KWPP.Application'){$word.Font.Size=32;$label.Text='季度复核 WPS'}
        else{if($label.Text -ne '季度复核 WPS'){throw 'PowerPoint 未读到 WPS 母版改动。'};$word.Font.Color.RGB=ColorNumber '2255AA'}
        $deck.Save()
      } else {
        if($prefix.Font.Name -ne 'Arial' -or $label.Font.Color.RGB -ne (ColorNumber '883311')){throw "$program 未读到砚页回存。"}
        if($suffix.Font.Name -eq 'Georgia'){throw "$program 相邻后缀字体被覆盖。"}
      }
      "$program $Phase 字符、母版背景与文字、两步段落动画通过。"
    }finally{$deck.Close()}
  }finally{
    if($owned -and $app.Presentations.Count -eq 0){$app.Quit()}
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
  }
}
