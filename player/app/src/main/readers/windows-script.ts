// The Windows helper: one fixed Windows PowerShell 5.1 script, kept alive, that reads the system
// media session (Global System Media Transport Controls) of the Spotify desktop app and writes
// one JSON line per poll, as UTF-8. Constants and two path functions, no I/O: the script is never
// built from data. Nothing is interpolated into it, and the only input it takes is the three
// command names on its standard input, compared against literals, and they go to the Spotify
// session only. A failed poll writes the fixed line {"error":true}; no session writes
// {"app":null}. While Spotify is not playing and another app is, the line is that app's id and
// "Playing" and nothing more (not its title): the link then shows Off the list (ADR 0001). It
// asks for no token, opens no connection and never starts the music app; it only looks at
// sessions that already exist (ADR 0001, option A).
import { win32 } from "node:path";

/** How often the script polls and how long it waits for one system call, both fixed in the script. */
export const HELPER_POLL_MS = 250;
export const HELPER_CALL_TIMEOUT_MS = 2000;

export const WINDOWS_HELPER_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($operation, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  if ($task.Wait(2000)) { $task.Result } else { throw 'timeout' }
}
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$manager = Await ($managerType::RequestAsync()) $managerType
$stdin = [System.IO.StreamReader]::new([Console]::OpenStandardInput())
$stdout = [System.IO.StreamWriter]::new([Console]::OpenStandardOutput(), (New-Object System.Text.UTF8Encoding $false))
$pending = $stdin.ReadLineAsync()
$spotifyIds = @('Spotify.exe', 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify')
while ($true) {
  $commands = @()
  while ($pending.IsCompleted) {
    if ($null -eq $pending.Result) { exit 0 }
    $commands += $pending.Result
    $pending = $stdin.ReadLineAsync()
  }
  $line = '{"error":true}'
  try {
    $sessions = @($manager.GetSessions())
    $session = $sessions | Where-Object { $spotifyIds -contains $_.SourceAppUserModelId } | Select-Object -First 1
    $status = ''
    if ($session) {
      foreach ($command in $commands) {
        if ($command -ceq 'play') { Await ($session.TryPlayAsync()) ([bool]) | Out-Null }
        elseif ($command -ceq 'pause') { Await ($session.TryPauseAsync()) ([bool]) | Out-Null }
        elseif ($command -ceq 'next') { Await ($session.TrySkipNextAsync()) ([bool]) | Out-Null }
      }
      $status = $session.GetPlaybackInfo().PlaybackStatus.ToString()
    }
    $other = $null
    if ($status -ne 'Playing') {
      $other = $sessions | Where-Object { $_.SourceAppUserModelId -and ($spotifyIds -notcontains $_.SourceAppUserModelId) -and ($_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') } | Select-Object -First 1
    }
    if ($other) {
      $line = [ordered]@{ app = $other.SourceAppUserModelId; status = 'Playing' } | ConvertTo-Json -Compress
    } elseif ($session) {
      $properties = Await ($session.TryGetMediaPropertiesAsync()) $propertiesType
      $timeline = $session.GetTimelineProperties()
      $line = [ordered]@{
        app = $session.SourceAppUserModelId
        status = $status
        title = $properties.Title
        artist = $properties.Artist
        positionMs = [int64]$timeline.Position.TotalMilliseconds
        startMs = [int64]$timeline.StartTime.TotalMilliseconds
        endMs = [int64]$timeline.EndTime.TotalMilliseconds
        lastUpdatedUtcMs = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
        nowUtcMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      } | ConvertTo-Json -Compress
    } else { $line = '{"app":null}' }
  } catch { }
  $stdout.WriteLine($line)
  $stdout.Flush()
  Start-Sleep -Milliseconds 250
}
`;

/** The script as PowerShell takes it on its command line: base64 of UTF-16LE. A constant. */
export const WINDOWS_HELPER_ENCODED = Buffer.from(WINDOWS_HELPER_SCRIPT, "utf16le").toString("base64");

/**
 * The whole argument list. No profile, no prompt, and the script; nothing else is ever passed.
 * `-InputFormat None` keeps PowerShell itself from reading the standard input, so the script's own
 * reader gets every line (and sees the input close when the application goes away).
 */
export const WINDOWS_HELPER_ARGS: readonly string[] = Object.freeze(["-NoLogo", "-NoProfile", "-NonInteractive", "-InputFormat", "None", "-EncodedCommand", WINDOWS_HELPER_ENCODED]);

const DEFAULT_SYSTEM_ROOT = "C:\\Windows";
const DRIVE_PATH = /^[A-Za-z]:\\[^"<>|?*\r\n\0]*$/;

/** The Windows directory, taken from the environment only when it is a plain absolute drive path. */
export function systemRoot(env: Readonly<Record<string, string | undefined>>): string {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? "";
  return DRIVE_PATH.test(root) && win32.normalize(root) === root.replace(/\\+$/, "") ? win32.normalize(root) : DEFAULT_SYSTEM_ROOT;
}

/**
 * Windows PowerShell 5.1 by its full path under the Windows directory, never a bare name looked
 * up on PATH (the 5.1 edition is the one that can load the system media session types).
 */
export function powershellPath(env: Readonly<Record<string, string | undefined>>): string {
  return win32.join(systemRoot(env), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}
