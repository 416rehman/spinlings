<#
.SYNOPSIS
  Records the Claude desktop app's window for the Spinlings launch media: an MP4, a palette-optimised GIF and PNG
  stills at 1270x760 (Product Hunt), 1200x675 (X) and 1280x640 (GitHub social preview).

.DESCRIPTION
  Finds the Claude desktop window, reads its rectangle (user32 GetWindowRect, tightened to the visible frame with
  DwmGetWindowAttribute so the invisible resize border is left out) and records exactly that screen region with
  ffmpeg's gdigrab desktop capture (-offset_x, -offset_y, -video_size). The region is always the window, or a part of
  it, clipped to the screen: nothing outside the Claude window is ever recorded. While recording, the window is
  brought to the front and kept on top so no other window can slide into the region; it is put back afterwards.

  Whatever is on screen inside the window is recorded, conversation included. Record in a fresh session in a
  throwaway project (docs/launch.md, "Before you record").

.PARAMETER Name
  Base name of the output files. Default: spinlings-<yyyyMMdd-HHmmss>.

.PARAMETER Seconds
  How long to record. Default 20.

.PARAMETER Crop
  window        the whole window, title bar included
  conversation  the window without the left sidebar and the title bar (default)
  x,y,w,h       a rectangle inside the window, in window pixels (clipped to the window)

.PARAMETER SidebarWidth
  Width of the sidebar left out by -Crop conversation, in logical (100% scale) pixels. 0 when it is collapsed.
  Default 288.

.PARAMETER TitleBarHeight
  Height of the title bar left out by -Crop conversation, in logical pixels. Default 40.

.PARAMETER Out
  Output folder. Default: .dev/capture under the repository (git-ignored).

.PARAMETER StillAt
  Seconds into the recording to take the PNG stills from; several values give several sets. Default: halfway.

.PARAMETER Fit
  pad  (default) scales the frame to fit each still size and fills the rest with -PadColor
  cover scales to fill each still size and crops the overflow evenly

.PARAMETER FromVideo
  Skip recording and make the GIF and stills from an existing MP4 (to re-cut a take).

.EXAMPLE
  ./scripts/capture/desktop.ps1 -Name encounter -Seconds 24
.EXAMPLE
  ./scripts/capture/desktop.ps1 -Name pack -Crop conversation -SidebarWidth 0 -StillAt 9.5,16
.EXAMPLE
  ./scripts/capture/desktop.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [string]$Name = ('spinlings-' + (Get-Date -Format 'yyyyMMdd-HHmmss')),
  [ValidateRange(1, 600)][double]$Seconds = 20,
  [string]$Crop = 'conversation',
  [ValidateRange(0, 2000)][int]$SidebarWidth = 288,
  [ValidateRange(0, 400)][int]$TitleBarHeight = 40,
  [ValidateRange(5, 60)][int]$Fps = 30,
  [ValidateRange(5, 50)][int]$GifFps = 20,
  [ValidateRange(200, 3840)][int]$GifWidth = 960,
  [double[]]$StillAt = @(),
  [ValidateSet('pad', 'cover')][string]$Fit = 'pad',
  [string]$PadColor = '#262624',
  [ValidateRange(0, 30)][int]$Delay = 3,
  [string]$WindowTitle = 'Claude',
  [string]$Out = '',
  [string]$FromVideo = '',
  [switch]$ShowCursor,
  [switch]$ShowRegion,
  [switch]$NoTopmost,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3

$Stills = @(
  @{ W = 1270; H = 760; Label = 'producthunt' },
  @{ W = 1200; H = 675; Label = 'x' },
  @{ W = 1280; H = 640; Label = 'github-social' }
)

function Fail([string]$message) {
  Write-Host "desktop.ps1: $message" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { Fail 'ffmpeg is not on PATH. Install it (winget install Gyan.FFmpeg) and open a new terminal.' }

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ($Out -eq '') { $Out = Join-Path $repo '.dev\capture' }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$base = Join-Path $Out $Name
$mp4 = "$base.mp4"

# numbers for ffmpeg in every locale: a dot, never a comma
function Num([double]$v) { return $v.ToString([Globalization.CultureInfo]::InvariantCulture) }

function Invoke-Ffmpeg([string[]]$ffArgs) {
  Write-Host ('ffmpeg ' + ($ffArgs -join ' ')) -ForegroundColor DarkGray
  if ($DryRun) { return }
  & ffmpeg -loglevel warning -stats @ffArgs
  if ($LASTEXITCODE -ne 0) { Fail "ffmpeg failed ($LASTEXITCODE)." }
}

# ---------- find the window and its rectangle ----------

if ($FromVideo -eq '') {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SpinWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT rect, int size);
}
'@

  # physical pixels, the coordinates gdigrab's desktop capture uses
  try { [void][SpinWin]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) } catch { [void][SpinWin]::SetProcessDPIAware() }

  $proc = Get-Process -Name 'claude' -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -like "$WindowTitle*" } |
    Select-Object -First 1
  if (-not $proc) { Fail "No Claude desktop window found (a window titled '$WindowTitle*'). Open the app first." }
  $hwnd = $proc.MainWindowHandle

  if ([SpinWin]::IsIconic($hwnd)) { [void][SpinWin]::ShowWindow($hwnd, 9); Start-Sleep -Milliseconds 400 }
  if (-not [SpinWin]::IsWindowVisible($hwnd)) { Fail 'The Claude window is not visible.' }

  $outer = New-Object SpinWin+RECT
  if (-not [SpinWin]::GetWindowRect($hwnd, [ref]$outer)) { Fail 'GetWindowRect failed.' }
  $frame = New-Object SpinWin+RECT
  $win = $outer
  # the visible frame, without the invisible resize border GetWindowRect counts in
  if ([SpinWin]::DwmGetWindowAttribute($hwnd, 9, [ref]$frame, 16) -eq 0) {
    $win = New-Object SpinWin+RECT
    $win.Left = [Math]::Max($outer.Left, $frame.Left); $win.Top = [Math]::Max($outer.Top, $frame.Top)
    $win.Right = [Math]::Min($outer.Right, $frame.Right); $win.Bottom = [Math]::Min($outer.Bottom, $frame.Bottom)
  }
  $dpi = 96
  try { $dpi = [int][SpinWin]::GetDpiForWindow($hwnd) } catch { $dpi = 96 }
  if ($dpi -le 0) { $dpi = 96 }
  $scale = $dpi / 96.0

  # the part of the window to record, in screen pixels
  $x = $win.Left; $y = $win.Top; $w = $win.Right - $win.Left; $h = $win.Bottom - $win.Top
  switch -Regex ($Crop) {
    '^window$' { }
    '^conversation$' {
      $sx = [int][Math]::Round($SidebarWidth * $scale); $ty = [int][Math]::Round($TitleBarHeight * $scale)
      $x += $sx; $w -= $sx; $y += $ty; $h -= $ty
    }
    '^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$' {
      $p = $Crop.Split(',') | ForEach-Object { [int]$_.Trim() }
      $x = $win.Left + $p[0]; $y = $win.Top + $p[1]; $w = $p[2]; $h = $p[3]
    }
    default { Fail "Unknown -Crop '$Crop': use window, conversation or x,y,w,h." }
  }

  # never outside the window, never off the screen
  $left = [Math]::Max([Math]::Max($x, $win.Left), [SpinWin]::GetSystemMetrics(76))
  $top = [Math]::Max([Math]::Max($y, $win.Top), [SpinWin]::GetSystemMetrics(77))
  $right = [Math]::Min([Math]::Min($x + $w, $win.Right), [SpinWin]::GetSystemMetrics(76) + [SpinWin]::GetSystemMetrics(78))
  $bottom = [Math]::Min([Math]::Min($y + $h, $win.Bottom), [SpinWin]::GetSystemMetrics(77) + [SpinWin]::GetSystemMetrics(79))
  $w = $right - $left; $h = $bottom - $top
  # H.264 wants even sides: trim, never grow
  $w -= $w % 2; $h -= $h % 2
  if ($w -lt 64 -or $h -lt 64) { Fail "The region to record is too small (${w}x${h}). Is the window on screen, and the crop inside it?" }

  Write-Host ("Claude window {0},{1} {2}x{3} at {4}% scale; recording {5},{6} {7}x{8} ({9})" -f `
      $win.Left, $win.Top, ($win.Right - $win.Left), ($win.Bottom - $win.Top), [int]($scale * 100), $left, $top, $w, $h, $Crop)

  # ---------- record ----------

  $topmost = -not $NoTopmost -and -not $DryRun
  if (-not $DryRun) {
    [void][SpinWin]::SetForegroundWindow($hwnd)
    if ($topmost) { [void][SpinWin]::SetWindowPos($hwnd, [IntPtr]::new(-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040) }
    for ($i = $Delay; $i -gt 0; $i--) { Write-Host "Recording in $i..."; Start-Sleep -Seconds 1 }
    Write-Host "Recording $Seconds s. Play the moment now." -ForegroundColor Yellow
  }
  try {
    $grab = @('-hide_banner', '-y', '-f', 'gdigrab', '-framerate', "$Fps", '-draw_mouse', $(if ($ShowCursor) { '1' } else { '0' }))
    if ($ShowRegion) { $grab += @('-show_region', '1') }
    $grab += @('-offset_x', "$left", '-offset_y', "$top", '-video_size', "${w}x${h}", '-t', (Num $Seconds), '-i', 'desktop',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', $mp4)
    Invoke-Ffmpeg $grab
  } finally {
    if ($topmost) { [void][SpinWin]::SetWindowPos($hwnd, [IntPtr]::new(-2), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0010) }
  }
  $length = $Seconds
} else {
  if (-not (Test-Path $FromVideo)) { Fail "No such video: $FromVideo" }
  $mp4 = (Resolve-Path $FromVideo).Path
  $length = $Seconds
  $probe = & ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $mp4 2>$null
  if ($probe) { $length = [double]::Parse(($probe | Select-Object -First 1), [Globalization.CultureInfo]::InvariantCulture) }
}

# ---------- the GIF: one pass, its own palette, only changed rectangles re-dithered ----------

$gif = "$base.gif"
$filter = "fps=$GifFps,scale='min($GifWidth,iw)':-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"
Invoke-Ffmpeg @('-hide_banner', '-y', '-i', $mp4, '-vf', $filter, '-loop', '0', $gif)

# ---------- the stills ----------

if ($StillAt.Count -eq 0) { $StillAt = @([Math]::Round($length / 2, 2)) }
$made = @()
foreach ($t in $StillAt) {
  $stamp = ('{0:0.00}' -f $t).Replace('.', '_')
  foreach ($s in $Stills) {
    $W = $s.W; $H = $s.H
    if ($Fit -eq 'cover') { $vf = "scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}" }
    else { $vf = "scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=$PadColor" }
    $png = "$base-$($s.Label)-${W}x${H}-t$stamp.png"
    Invoke-Ffmpeg @('-hide_banner', '-y', '-ss', (Num $t), '-i', $mp4, '-frames:v', '1', '-vf', $vf, '-update', '1', $png)
    $made += $png
  }
}

Write-Host ''
if ($DryRun) { Write-Host 'Dry run: nothing was recorded.' -ForegroundColor Yellow; exit 0 }
Write-Host "MP4   $mp4"
Write-Host "GIF   $gif ($([Math]::Round((Get-Item $gif).Length / 1KB)) KB)"
foreach ($p in $made) { Write-Host "PNG   $p" }
