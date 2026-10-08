param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'
$path = Join-Path $ProjectRoot 'src\epf\DtCons83Monaco\DtCons83Monaco\Ext\ObjectModule.bsl'
$text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
$registration = -join ([char[]](0x041F,0x0430,0x0440,0x0430,0x043C,0x0435,0x0442,0x0440,0x044B,0x0420,0x0435,0x0433,0x0438,0x0441,0x0442,0x0440,0x0430,0x0446,0x0438,0x0438))
$versionWord = -join ([char[]](0x0412,0x0435,0x0440,0x0441,0x0438,0x044F))
$pattern = '(' + [regex]::Escape($registration) + '\.' + [regex]::Escape($versionWord) + '\s*=\s*"\d+\.\d+\.)(\d+)(";)'
$match = [regex]::Match($text, $pattern)
if (-not $match.Success) { throw "Processor version was not found: $path" }
$current = [int]$match.Groups[2].Value
$next = $current + 1
$updated = [regex]::Replace($text, $pattern, { param($m) $m.Groups[1].Value + $next + $m.Groups[3].Value }, 1)
[System.IO.File]::WriteAllText($path, $updated, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("Version bumped: 5.0.{0} -> 5.0.{1}" -f $current, $next)
