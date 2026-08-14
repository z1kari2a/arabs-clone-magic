; NSIS script for the ERP Windows installer.
;
; Not meant to be run by hand — scripts/make-installer.mjs fills in the defines
; below and calls makensis. It turns electron-release/ERP-win32-x64/ into a
; single Setup .exe that installs into Program Files, creates Start-menu and
; desktop shortcuts, and registers a proper entry under
; "Programs and Features" so the app uninstalls like any other program.

; A native 64-bit, Unicode installer: the app itself is x64-only, and Unicode
; is what makes the Arabic strings below render as Arabic.
Target amd64-unicode
ManifestDPIAware true

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!ifndef APP_DIR
  !error "APP_DIR is not defined — run: npm run make:installer"
!endif

!define APP_NAME       "ERP"
!define APP_TITLE      "ERP — نظام المشتريات"
!define PUBLISHER      "Fikra Digital"
!define EXE_NAME       "ERP.exe"
!define REG_UNINSTALL  "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"

Name "${APP_TITLE}"
BrandingText "${PUBLISHER}"
OutFile "${OUT_FILE}"
InstallDir "$PROGRAMFILES64\${APP_NAME}"
InstallDirRegKey HKLM "Software\${PUBLISHER}\${APP_NAME}" "InstallDir"
RequestExecutionLevel admin   ; Program Files needs elevation

; Solid LZMA: an Electron payload is ~350 MB of highly compressible files.
SetCompressor /SOLID lzma
SetCompressorDictSize 64

; ---------------------------------------------------------------- appearance

!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
; The installer is elevated, so a plain MUI_FINISHPAGE_RUN would start the app
; as administrator — and it would keep running that way, writing its database
; into the administrator's profile. Launching through Explorer hands the
; process back to the logged-in user.
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchAsUser
!define MUI_FINISHPAGE_RUN_TEXT "تشغيل البرنامج الآن"
; One-click install: no Welcome page and no Directory-choice page. Double-
; clicking the Setup .exe (after the UAC prompt Windows requires for a
; Program Files install) starts copying files immediately — the only screen
; before Finish is the progress bar. There is nothing to click, choose, or
; customize; it always installs to Program Files.

Function LaunchAsUser
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\${EXE_NAME}"'
FunctionEnd

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Arabic"
!insertmacro MUI_LANGUAGE "English"

; ------------------------------------------------------------------- install

Function .onInit
  ; 64-bit payload: write to the real Program Files and the 64-bit registry
  ; view, not the WOW6432 redirected ones.
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "هذا البرنامج يحتاج إلى نسخة 64-بت من Windows."
    Abort
  ${EndIf}
  SetRegView 64

  ; A running copy would hold ERP.exe open and fail the file writes.
  nsExec::Exec 'taskkill /F /IM "${EXE_NAME}"'
  Pop $0
FunctionEnd

Section "install"
  SetOutPath "$INSTDIR"
  SetOverwrite on
  ; Forward slashes on purpose: makensis running on Linux does not translate
  ; backslashes in a source path, and would look for a file literally named
  ; "electron-release\ERP-win32-x64".
  File /r "${APP_DIR}/*"

  ; Shortcuts: Start menu (all users) and desktop.
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_TITLE}.lnk" "$INSTDIR\${EXE_NAME}" "" "$INSTDIR\${EXE_NAME}" 0
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\إزالة ${APP_NAME}.lnk" "$INSTDIR\uninstall.exe"
  CreateShortcut "$DESKTOP\${APP_TITLE}.lnk" "$INSTDIR\${EXE_NAME}" "" "$INSTDIR\${EXE_NAME}" 0

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "Software\${PUBLISHER}\${APP_NAME}" "InstallDir" "$INSTDIR"

  ; "Programs and Features" entry — this is what makes Windows treat the app as
  ; installed software rather than a folder someone copied onto the machine.
  WriteRegStr   HKLM "${REG_UNINSTALL}" "DisplayName"     "${APP_TITLE}"
  WriteRegStr   HKLM "${REG_UNINSTALL}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr   HKLM "${REG_UNINSTALL}" "Publisher"       "${PUBLISHER}"
  WriteRegStr   HKLM "${REG_UNINSTALL}" "DisplayIcon"     "$INSTDIR\${EXE_NAME}"
  WriteRegStr   HKLM "${REG_UNINSTALL}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKLM "${REG_UNINSTALL}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr   HKLM "${REG_UNINSTALL}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKLM "${REG_UNINSTALL}" "NoModify" 1
  WriteRegDWORD HKLM "${REG_UNINSTALL}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${REG_UNINSTALL}" "EstimatedSize" "$0"
SectionEnd

; ----------------------------------------------------------------- uninstall

Function un.onInit
  SetRegView 64
  nsExec::Exec 'taskkill /F /IM "${EXE_NAME}"'
  Pop $0
FunctionEnd

Section "un.install"
  Delete "$DESKTOP\${APP_TITLE}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_TITLE}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\إزالة ${APP_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${APP_NAME}"

  RMDir /r "$INSTDIR"

  DeleteRegKey HKLM "${REG_UNINSTALL}"
  DeleteRegKey HKLM "Software\${PUBLISHER}\${APP_NAME}"

  ; The user's database lives in %APPDATA%\erp and is deliberately left behind —
  ; uninstalling the program must not destroy the company's data. Reinstalling
  ; picks it back up. (A silent uninstall stays silent: MessageBox would still
  ; block on /S, and QuietUninstallString promises no UI.)
  ${IfNot} ${Silent}
    MessageBox MB_ICONINFORMATION|MB_OK "تمت إزالة البرنامج.$\n$\nبياناتك محفوظة في:$\n$APPDATA\erp"
  ${EndIf}
SectionEnd
