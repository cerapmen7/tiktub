#!/usr/bin/env bash
set -e
echo "🚀 TikTub Setup — TikTok → YouTube Automation"

if ! command -v node &> /dev/null; then echo "✗ Node.js non trouvé (v18+)"; exit 1; fi
echo "✓ Node $(node -v)"

if [ ! -f .env ]; then cp .env.example .env; echo "✓ .env créé — édite GOOGLE_CLIENT_ID/SECRET"; else echo "✓ .env existe"; fi
if [ ! -f backend/.env ]; then cp .env backend/.env 2>/dev/null || cp .env.example backend/.env; fi

echo "📦 Installation..."
npm install
npm install --workspace=backend
npm install --workspace=frontend
npm install --workspace=@tiktub/tiktok-agent
npm install --workspace=@tiktub/youtube-agent
npm install --workspace=@tiktub/scheduler-agent
npm install --workspace=@tiktub/orchestrator-agent

echo "🗄️  Prisma..."
(cd backend && npx prisma generate; npx prisma db push --accept-data-loss || echo "⚠️ fallback JSON")

echo "🔨 Build..."
npm run build --workspace=backend
npm run build --workspace=frontend

echo "✅ Setup terminé !"
echo "→ Édite .env (GOOGLE_*) puis: npm run dev"
echo "→ Frontend http://localhost:5173  Backend http://localhost:3001"
