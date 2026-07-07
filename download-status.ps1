# Live download status for the Chatterbox model files (~3045 MB total).
# Prints a fresh line every 10 seconds. Close the window to stop watching —
# the download itself keeps running regardless.
#
# NOTE: if the display ever seems frozen, you probably clicked inside the
# window (Windows pauses console output in select mode) — press Enter or
# Esc to resume.

$dir = Join-Path $PSScriptRoot 'models\chatterbox'
$totalMB = 3045
$prev = -1.0
$prevTime = Get-Date

Write-Host 'Chatterbox download status (close window to exit)' -ForegroundColor Cyan
Write-Host 'If the numbers stop, press Enter — clicking the window pauses output.'
Write-Host ''

while ($true) {
    $mb = 0.0
    if (Test-Path $dir) {
        $sum = (Get-ChildItem $dir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
        if ($sum) { $mb = [math]::Round($sum / 1MB, 1) }
    }
    $pct = [math]::Round(($mb / $totalMB) * 100, 1)
    $now = Get-Date

    $extra = ''
    if ($prev -ge 0) {
        $elapsed = ($now - $prevTime).TotalSeconds
        if ($elapsed -gt 0) {
            $kbs = [math]::Round((($mb - $prev) * 1024) / $elapsed, 0)
            $extra = "  $kbs KB/s"
            if ($kbs -gt 0) {
                $mins = [math]::Round((($totalMB - $mb) * 1024) / $kbs / 60, 0)
                $extra += "  ~$mins min left"
            } else {
                $extra += "  (stalled - auto-retry is active)"
            }
        }
    }

    $stamp = $now.ToString("HH:mm:ss")
    Write-Host "[$stamp]  $mb MB / $totalMB MB  ($pct%)$extra"

    $prev = $mb
    $prevTime = $now
    Start-Sleep -Seconds 10
}
