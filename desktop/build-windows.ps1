$ErrorActionPreference = "Stop"

$DesktopDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $DesktopDir
$BuildDir = Join-Path $DesktopDir "build"
$DistDir = Join-Path $RootDir "dist"

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

# Generate brand icon (havsAI.ico) using System.Drawing
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 64, 64
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 8, 16, 5))
$greenPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 0, 161, 13), 4)
$greenBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0, 161, 13))
$orangeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 234, 88, 12))

$g.FillRectangle($bgBrush, 0, 0, 64, 64)
$g.DrawRectangle($greenPen, 4, 4, 56, 56)
$g.FillRectangle($greenBrush, 14, 14, 9, 36)
$g.FillRectangle($greenBrush, 14, 28, 22, 8)
$g.FillRectangle($greenBrush, 27, 28, 9, 22)
$g.FillEllipse($orangeBrush, 38, 14, 12, 12)
$g.Dispose()

$icoPath = Join-Path $BuildDir "havsAI.ico"
$iconHandle = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($iconHandle)
$fs = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()
$bmp.Dispose()

$cscCandidates = @(
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) {
    throw "C# compiler (csc.exe) not found."
}

$exeOut = Join-Path $BuildDir "havsAI-Desktop.exe"
$csFile = Join-Path $DesktopDir "Program.cs"

& $csc /nologo /target:winexe /optimize+ /out:$exeOut /win32icon:$icoPath /r:System.dll /r:System.Windows.Forms.dll $csFile
if ($LASTEXITCODE -ne 0) {
    throw "Failed to compile havsAI-Desktop.exe"
}

Copy-Item -Force (Join-Path $DesktopDir "config.json") (Join-Path $BuildDir "config.json")
Copy-Item -Force $exeOut (Join-Path $DistDir "havsAI-Desktop.exe")
Copy-Item -Force (Join-Path $DesktopDir "config.json") (Join-Path $DistDir "config.json")

Write-Output "Built Desktop executable: $exeOut and $(Join-Path $DistDir 'havsAI-Desktop.exe')"
