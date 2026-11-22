Write-Host "=== STEP 1: Kill Node/tsx processes ===" -ForegroundColor Cyan
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "tsx"  -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "Done." -ForegroundColor Green

Write-Host "=== STEP 2: Free ports 3000 3001 5173 5174 ===" -ForegroundColor Cyan
$ports = @(3000, 3001, 5173, 5174)
foreach ($port in $ports) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($conn) {
        $ownerPid = ($conn | Select-Object -First 1).OwningProcess
        Write-Host "  Port $port held by PID $ownerPid - killing..."
        Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "  Port $port is free." -ForegroundColor Gray
    }
}

Write-Host "=== STEP 3: Docker Compose down ===" -ForegroundColor Cyan
Set-Location d:\Projects\SimpleCI
docker compose down
Write-Host "Done." -ForegroundColor Green

Write-Host "=== STEP 4: Docker Compose up ===" -ForegroundColor Cyan
docker compose up -d
Write-Host "Waiting 8s for services..." -ForegroundColor Yellow
Start-Sleep -Seconds 8
docker compose ps

Write-Host ""
Write-Host "=== ALL DONE - Open 3 terminals ===" -ForegroundColor Magenta
Write-Host ""
Write-Host "Terminal 1 - Backend:" -ForegroundColor Yellow
Write-Host "  cd d:\Projects\SimpleCI\apps\backend"
Write-Host "  npm run dev:server"
Write-Host ""
Write-Host "Terminal 2 - Worker:" -ForegroundColor Yellow
Write-Host "  cd d:\Projects\SimpleCI\apps\backend"
Write-Host "  npm run dev:worker"
Write-Host ""
Write-Host "Terminal 3 - Frontend:" -ForegroundColor Yellow
Write-Host "  cd d:\Projects\SimpleCI\apps\frontend"
Write-Host "  npm run dev"
Write-Host ""
Write-Host "Then open: http://localhost:5173" -ForegroundColor Cyan
