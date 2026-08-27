; TikTub NSIS custom installer script
; Affiche une belle présentation, crée raccourcis

!macro customHeader
  ; Personnalisation header
!macroend

!macro customInstall
  ; Crée dossier downloads dans AppData
  CreateDirectory "$APPDATA\TikTub\downloads"
  ; Message de bienvenue
!macroend

!macro customUnInstall
  ; Nettoyage optionnel (garde les données utilisateur)
  MessageBox MB_YESNO "Voulez-vous supprimer les données TikTub (base + téléchargements) ?" IDYES removeData IDNO keepData
  removeData:
    RMDir /r "$APPDATA\TikTub"
    Goto done
  keepData:
  done:
!macroend
