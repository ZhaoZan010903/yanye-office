if (!('YanYeRevisionApp' -as [type])) {
  Add-Type 'using System; using System.Runtime.InteropServices; public static class YanYeRevisionApp { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId); }'
}
function Use-Document([string]$program,[string]$path,[bool]$create,[scriptblock]$operation) {
  $running=@((Get-Process).Id)
  $app=New-Object -ComObject $program
  $owned=$false
  $startedEmpty=$app.Documents.Count -eq 0
  try {
    try {
      [uint32]$appId=0
      [void][YanYeRevisionApp]::GetWindowThreadProcessId([IntPtr]$app.Hwnd,[ref]$appId)
      $owned=$appId -ne 0 -and $appId -notin $running -and $app.Documents.Count -eq 0
    } catch {}
    $missing=[Type]::Missing
    if ($program -eq 'Word.Application' -and ($app.Visible -or $app.Documents.Count -gt 0)) {throw '本用例需要独立的后台 Word 自动化实例。'}
    if ($create) {$doc=$app.Documents.Add($missing,$false,0,$false)}
    # Word requires an internal document window for RejectAll/AcceptAll.
    # Its owning automation application stays invisible throughout.
    elseif ($program -eq 'Word.Application') {$doc=$app.Documents.Open($path,$false,$false,$false)}
    else {$doc=$app.Documents.Open($path,$false,$false,$false,$missing,$missing,$false,$missing,$missing,$missing,$missing,$false)}
    if (!$owned -and $startedEmpty) {
      try {
        [uint32]$documentPid=0
        [void][YanYeRevisionApp]::GetWindowThreadProcessId([IntPtr]$doc.Windows.Item(1).Hwnd,[ref]$documentPid)
        $owned=$documentPid -ne 0 -and $documentPid -notin $running
      } catch {}
    }
    try {& $operation $doc} finally {$doc.Close(0)}
  } finally {
    if ($owned -and $app.Documents.Count -eq 0) {$app.Quit()}
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
  }
}
