# TikTub — Installation Desktop (.exe)

## 📦 Télécharger

L'installateur Windows est dans `dist-installer/` après build:

- **Installateur** `TikTub-Setup-1.0.0.exe` (95.8 MB) — setup avec belle présentation
- **Portable** `TikTub-Portable-1.0.0.exe` (100 MB) — sans installation

Sur GitHub: https://github.com/cerapmen7/tiktub/releases (après `git tag`)

## ✨ Présentation de l'installateur

L'installateur NSIS a été configuré pour une belle présentation:

- **Icône** `assets/icon.ico` (512x512 gradient violet → sombre, logo blanc)
- **Header** `build/installerHeader.png` (164x314) + **Sidebar** `build/installerSidebar.png`
- **Licence** `build/license.txt` (MIT + conditions ToS)
- **Langue** Français (1036), pas de sélecteur
- **Options**: choix dossier d'installation, raccourci Bureau + Menu Démarrer, `oneClick: false` (pas silencieux, l'utilisateur voit chaque étape), élévation admin si besoin, `include: build/installer.nsh` pour dossier downloads
- **Splash** `electron/src/splash.html` (fenêtre 420x380 transparente, animation barre, logo flottant) au démarrage de l'app
- **Menu** `electron/src/main.ts` (Fichier/Affichage/Aide, santé backend, dossier données)

## 🚀 Installer

1. Double-clic `TikTub-Setup-1.0.0.exe`
2. Choisis le dossier (défaut `%LocalAppData%\Programs\TikTub`)
3. Coche "Créer raccourci Bureau"
4. Installe → lance via raccourci **TikTub** (ou Menu Démarrer)

L'app démarre:
- Splash violet → backend Express sur `http://localhost:3001` (ELECTRON_RUN_AS_NODE)
- Fenêtre 1280x820 `TikTub — TikTok → YouTube` (icon, menu)
- Si `http://localhost:5173` (Vite) existe → hot-reload, sinon fallback `http://localhost:3001` (backend sert `frontend/dist`)

## 🔧 Build depuis les sources

```powershell
cd C:\Users\PC NANDY\Desktop\tiktub
.\setup.ps1          # 1ère fois: deps + prisma + build
npm run dist:win     # build complet + NSIS + portable (3-5 min)
# Résultat:
# dist-installer/TikTub-Setup-1.0.0.exe
# dist-installer/TikTub-Portable-1.0.0.exe
# dist-installer/win-unpacked/TikTub.exe (test sans installer)
```

Pour tester sans installer:
```powershell
.\dist-installer\win-unpacked\TikTub.exe
# ou
npx electron .
# ou dev
npm run dev          # backend 3001 + frontend 5173
npm run dev:electron # electron + backend + frontend
```

## 📂 Données

- **DB** `%APPDATA%\TikTub\tiktub.db` (ou `C:\Users\<user>\AppData\Roaming\TikTub\tiktub.db`)
- **Downloads** `%APPDATA%\TikTub\downloads`
- **Logs** console Electron + backend (`[backend]`)

Désinstallation: Panneau de configuration → TikTub → Désinstaller (propose de garder/supprimer données)

## 🖥️ Détails techniques

- **Electron 32.3.3**, **electron-builder 24.13.3**, **NSIS**
- **asar: true** + `asarUnpack: backend, frontend, shared, node_modules, dist-electron` pour spawn backend via `process.execPath` + `ELECTRON_RUN_AS_NODE=1`
- **Backend** `backend/dist/index.js` (Express + Prisma) sert `frontend/dist` quand `ELECTRON=true`
- **Frontend** `frontend/dist` (Vite + React + Tailwind)

Pour la prod, le backend utilise `DATABASE_URL=file:.../AppData/Roaming/TikTub/tiktub.db` (pas `backend/data/tiktub.db`)

## ⚠️ Notes

- **Antivirus** peut flagger l'installateur non signé (normal) → autoriser
- **YouTube**: configure `GOOGLE_CLIENT_ID/SECRET` dans `%APPDATA%\TikTub\.env` ou via l'app (wizard)
