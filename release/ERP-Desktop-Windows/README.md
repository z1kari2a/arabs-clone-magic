# نسخة سطح المكتب — ويندوز

| | |
|---|---|
| الملف | `ERP-Setup-1.0.0.exe` |
| الحجم | 94 ميغابايت |
| النظام | Windows 10/11 — 64 بت |
| الإصدار | 1.0.0 |
| SHA-256 | `a31fcaddd0a9f522159a1ad618312ad2435fd9e0d23137aec4a9089f010e9cfd` |

## التثبيت

1. حمّل `ERP-Setup-1.0.0.exe` من هذا المجلد.
2. شغّله بالضغط المزدوج. إذا ظهرت نافذة SmartScreen اختر **More info** ثم **Run anyway** (المثبّت غير موقّع رقمياً).
3. اتبع خطوات المثبّت — يُنشئ اختصاراً على سطح المكتب وفي قائمة ابدأ.

## التحقق من سلامة الملف

في PowerShell:

```powershell
Get-FileHash .\ERP-Setup-1.0.0.exe -Algorithm SHA256
```

يجب أن تطابق النتيجة قيمة SHA-256 أعلاه.

## إعادة البناء من المصدر

```bash
npm install
npm run build:electron     # يبني الواجهة إلى dist-electron
node scripts/make-win.mjs  # يحزّم التطبيق إلى electron-release/ERP-win32-x64
node scripts/make-installer.mjs  # ينتج المثبّت ERP-Setup-1.0.0.exe
```

ناتج البناء يظهر في `electron-release/` وهو مجلد مستثنى من Git؛ هذا المجلد (`release/`) يحتفظ بالنسخة الجاهزة للتوزيع فقط.
