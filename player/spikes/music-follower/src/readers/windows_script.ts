// The PowerShell/WinRT script for the Windows reader (system media transport controls).
// It only reads the Spotify session; it never sends a transport command.

export function windowsScript(intervalMs: number): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result
}
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$propType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$mgr = Await ($mgrType::RequestAsync()) $mgrType
while ($true) {
  $s = $mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -like '*Spotify*' } | Select-Object -First 1
  if ($s) {
    $p = Await ($s.TryGetMediaPropertiesAsync()) $propType
    $tl = $s.GetTimelineProperties()
    $pb = $s.GetPlaybackInfo()
    [ordered]@{
      status = $pb.PlaybackStatus.ToString()
      title = $p.Title
      artist = $p.Artist
      positionMs = [int64]$tl.Position.TotalMilliseconds
      startMs = [int64]$tl.StartTime.TotalMilliseconds
      endMs = [int64]$tl.EndTime.TotalMilliseconds
      lastUpdatedUtcMs = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
      nowUtcMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json -Compress
  } else { 'none' }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${Math.max(50, Math.round(intervalMs))}
}
`;
}
