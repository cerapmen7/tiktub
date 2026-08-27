@echo off
title TikTub
color 0B
echo ========================================
echo   TikTub - TikTok vers YouTube
echo   Lancement de l'application...
echo ========================================
echo.

cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERREUR] Node.js non trouve. Installe https://nodejs.org (v18+)
  pause
  exit /b 1
)

if not exist ".env" (
  echo [.env] creation depuis .env.example...
  copy ".env.example" ".env" >nul
)

if not exist "backend\.env" copy ".env" "backend\.env" >nul 2>&1

if not exist "data\tiktub.db" (
  echo [DB] initialisation...
  pushd backend
  call npx prisma db push --accept-data-loss >nul 2>&1
  popd
)

echo [1/2] Backend sur http://localhost:3001 ...
start "TikTub Backend" /min cmd /c "cd /d ""%~dp0backend"" && node dist\index.js"

timeout /t 4 /nobreak >nul

echo [2/2] Frontend sur http://localhost:5173 ...
REM En dev on lance Vite, en prod le backend sert deja le frontend build
REM On ouvre directement le frontend dev si dispo, sinon le backend en prod

timeout /t 2 /nobreak >nul

echo.
echo Ouverture du navigateur...
start http://localhost:5173
REM fallback prod :
timeout /t 3 /nobreak >nul
start http://localhost:3001/api/health

echo.
echo ========================================
echo   TikTub lance !
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:3001/api/health
echo   Pour arreter: ferme les fenetres "TikTub Backend"
echo ========================================
pause
