# TikTub Setup - Windows PowerShell
# Usage: .\setup.ps1  ou  powershell -ExecutionPolicy Bypass -File setup.ps1

Write-Host "🚀 TikTub Setup — TikTok → YouTube Automation" -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

function Check-Node {
  try {
    $v = node -v
    Write-Host "✓ Node.js $v" -ForegroundColor Green
    return $true
  } catch {
    Write-Host "✗ Node.js non trouvé. Installe https://nodejs.org (v18+)" -ForegroundColor Red
    return $false
  }
}

if (-not (Check-Node)) { exit 1 }

# 1. Env
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "✓ .env créé depuis .env.example — édite-le (GOOGLE_CLIENT_ID/SECRET)" -ForegroundColor Yellow
} else {
  Write-Host "✓ .env existe déjà" -ForegroundColor Green
}

if (-not (Test-Path "backend\.env")) {
  Copy-Item ".env" "backend\.env" -ErrorAction SilentlyContinue
  if (-not (Test-Path "backend\.env")) { Copy-Item ".env.example" "backend\.env" }
}

# 2. Install
Write-Host "`n📦 Installation dépendances..." -ForegroundColor Cyan
npm install
npm install --workspace=backend
npm install --workspace=frontend
npm install --workspace=@tiktub/tiktok-agent
npm install --workspace=@tiktub/youtube-agent
npm install --workspace=@tiktub/scheduler-agent
npm install --workspace=@tiktub/orchestrator-agent

# 3. Prisma
Write-Host "`n🗄️  Initialisation base de données..." -ForegroundColor Cyan
Set-Location backend
npx prisma generate
# tente db push avec fallback
try {
  npx prisma db push --accept-data-loss
  Write-Host "✓ DB prête" -ForegroundColor Green
} catch {
  Write-Host "⚠️  Prisma push échoué, fallback JSON activé (pas bloquant): $_" -ForegroundColor Yellow
}
Set-Location ..

# 4. Build
Write-Host "`n🔨 Build..." -ForegroundColor Cyan
npm run build --workspace=backend
npm run build --workspace=frontend

Write-Host "`n✅ Setup terminé !" -ForegroundColor Green
Write-Host ""
Write-Host "Prochaines étapes:" -ForegroundColor Cyan
Write-Host "  1. Édite .env et backend\.env → remplis GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI"
Write-Host "     → https://console.cloud.google.com → APIs & Services → Credentials"
Write-Host "     → Active YouTube Data API v3"
Write-Host "     → OAuth redirect: http://localhost:3001/api/youtube/callback"
Write-Host "  2. Lance en dev: npm run dev"
Write-Host "     Backend: http://localhost:3001  Frontend: http://localhost:5173"
Write-Host "  3. Ouvre http://localhost:5173 → Wizard → Connect YouTube → Add @handles"
Write-Host ""
Write-Host "Mode MOCK: sans credentials Google, l'app simule les uploads (vidéos fake) pour tester le flux complet."
