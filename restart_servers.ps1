# restart_servers.ps1
Write-Host "Restarting NeuroGuard servers..." -ForegroundColor Cyan

# Kill existing processes
Write-Host "Killing existing node and python processes..."
Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "python" -Force -ErrorAction SilentlyContinue

Start-Sleep -Seconds 2

# Start Python AI Service in background
Write-Host "Starting Python AI Service..." -ForegroundColor Green
Start-Process -FilePath "python" -ArgumentList "ai_service/ai_service.py" -NoNewWindow -PassThru

# Start Node.js Vite server in background
Write-Host "Starting Node.js Backend..." -ForegroundColor Green
Start-Process -FilePath "npm.cmd" -ArgumentList "run dev" -NoNewWindow -PassThru

Write-Host "Both servers have been restarted!" -ForegroundColor Yellow
