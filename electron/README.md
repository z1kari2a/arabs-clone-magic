# ERP Desktop (Electron)

هذه ملفات تحويل النظام إلى برنامج ويندوز محلي مستقل.

## أول مرة على جهاز التطوير

```bash
npm install --save-dev electron @electron/packager
npm install better-sqlite3 bcryptjs
```

## تجربة محلياً (بعد بناء الواجهة)

```bash
npm run build              # يبني الواجهة إلى مجلد dist/
npx electron electron/main.cjs
```

أو مباشرة (يعمل إعادة البناء + تشغيل Electron):

```bash
npm run electron:start
```

## إنشاء ملف EXE لويندوز

```bash
npm run electron:build:win
```

الناتج في `electron-release/ERP-win32-x64/` — يحتوي على `ERP.exe` مباشرة.

## أين تُحفظ البيانات؟

ملف `erp.db` يوضع في:

- Windows: `%APPDATA%\ERP\erp.db`
- macOS:   `~/Library/Application Support/ERP/erp.db`
- Linux:   `~/.config/ERP/erp.db`

زر "نسخة احتياطية" في قائمة "ملف" يتيح لك حفظ نسخة من هذا الملف في أي مكان.