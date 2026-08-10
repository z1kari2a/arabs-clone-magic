# ERP Desktop (Electron)

هذه ملفات تحويل النظام إلى برنامج ويندوز محلي مستقل.

## إنشاء ملف EXE لويندوز

```bash
npm run make:win
```

أمر واحد يقوم بكل شيء: بناء الواجهة، جلب مكتبة SQLite الخاصة بويندوز، التحزيم،
ثم التحقق من أن الناتج كامل. النتيجة في:

```
electron-release/ERP-win32-x64/ERP.exe
```

انسخ **المجلد كاملاً** (وليس ملف الـ exe وحده) إلى جهاز الويندوز وشغّل `ERP.exe`.

الحجم ≈ 350 ميغابايت لأن Electron يحمل متصفح Chromium كاملاً — هذا طبيعي.

### ماذا يحتاج جهاز البناء؟

| الحالة | النتيجة |
|---|---|
| البناء على ويندوز | كل شيء يعمل مباشرة |
| البناء على لينكس مع `wine` مثبت | كل شيء يعمل، بما فيه الأيقونة وبيانات الإصدار |
| البناء على لينكس بلا `wine` | الـ exe يعمل لكن بأيقونة Electron الافتراضية وبلا بيانات إصدار |

على أوبونتو: `apt-get install wine64` (السكربت يجده تلقائياً حتى لو لم يكن في `PATH`).

## أوامر مساعدة

```bash
npm run build:electron   # بناء الواجهة فقط إلى dist-electron/
npm run electron:start   # بناء + تشغيل محلي للتجربة
npm run icon             # إعادة توليد build/icon.ico من public/favicon.ico
npm run fonts:fetch      # إعادة تحميل خط Cairo المحلي
npm run sqlite:prebuild  # جلب better_sqlite3.node لويندوز فقط
npm run make:linux       # نفس التحزيم لكن لهدف لينكس (للفحص)
```

`icon` و `fonts:fetch` تحتاجان إنترنت/مكتبة sharp، ونواتجهما **محفوظة في المستودع**،
فالبناء العادي لا يحتاج تشغيلهما.

## لماذا سكربت بدل `electron-packager` مباشرة؟

`package.json` يحتوي على منتجين يتشاركان نفس المستودع:

- `electron/main.cjs` — البرنامج المستقل (هذا المقصود بـ `make:win`)
- `electron/shell-main.cjs` — قشرة الترخيص التي تنزّل الحزمة من السيرفر

حقل `main` يشير إلى الثاني، لذلك `electron-packager` وحده كان ينتج برنامج القشرة
بالخطأ. `scripts/make-win.mjs` يصحح ذلك داخل الحزمة، ويحقن نسخة SQLite الخاصة
بويندوز (وحدة native لا يمكن بناؤها على لينكس)، ويستبعد شجرة React من
`node_modules` لأنها مدمجة أصلاً في `dist-electron`.

## أين تُحفظ البيانات؟

ملف `erp.db` يوضع في:

- Windows: `%APPDATA%\ERP\erp.db`
- macOS:   `~/Library/Application Support/ERP/erp.db`
- Linux:   `~/.config/ERP/erp.db`

زر "نسخة احتياطية" في قائمة "ملف" يتيح لك حفظ نسخة من هذا الملف في أي مكان.

## يعمل بلا إنترنت

الخط (Cairo) مضمَّن محلياً، ولا توجد أي طلبات شبكة عند الإقلاع — تم التحقق من
ذلك عبر `performance.getEntriesByType('resource')` على الحزمة المبنية.
