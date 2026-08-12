# مزامنة Appwrite

مزامنة ثنائية الاتجاه بين قاعدة SQLite المحلية (`erp.db`) وقاعدة بيانات Appwrite.

---

## 1. الإعداد

انسخ ملف المثال واملأ المفتاح:

```bash
cp .env.appwrite.example .env.appwrite
```

ثم افتح `.env.appwrite` وضع القيم:

| المتغير | الوصف |
|---|---|
| `APPWRITE_ENDPOINT` | `https://nyc.cloud.appwrite.io/v1` |
| `APPWRITE_PROJECT_ID` | معرّف المشروع |
| `APPWRITE_DATABASE_ID` | معرّف قاعدة البيانات |
| `APPWRITE_API_KEY` | مفتاح API — **مطلوب** |
| `APPWRITE_SQLITE_PATH` | اختياري: مسار `erp.db` (يُكتشف تلقائياً) |
| `APPWRITE_SYNC_SCOPE` | اختياري: اسم الجهاز/العميل (الافتراضي `default`) |

المفتاح يحتاج الصلاحيات: `databases.*`, `collections.*`, `attributes.*`, `indexes.*`, `documents.*`.

> **`.env.appwrite` مُستثنى من git** — لا يُرفع إلى GitHub أبداً. لا توجد أي بيانات
> اعتماد مكتوبة داخل الكود؛ كل شيء يُقرأ من `process.env` بعد `dotenv`.

---

## 2. إنشاء الـ Schema

```bash
npm run appwrite:schema:check   # عرض ما سيُنشأ دون أي تغيير
npm run appwrite:schema         # الإنشاء الفعلي
```

السكريبت **idempotent**: شغّله متى شئت، لا يُنشئ إلا الناقص، ولا يحذف ولا يغيّر نوع
حقل موجود (ذلك يُتلف البيانات) — بل ينبّه فقط.

### الجداول المُنشأة (15 مجموعة)

| المجموعة | المصدر | تُزامَن؟ |
|---|---|---|
| `suppliers` | `supabase/migrations` | ✅ |
| `items` | `supabase/migrations` | ✅ |
| `purchase_orders` | `supabase/migrations` | ✅ |
| `po_rows` | `supabase/migrations` | ✅ (تابعة لأمر الشراء) |
| `po_expenses` | `supabase/migrations` | ✅ (تابعة لأمر الشراء) |
| `purchase_requests` | التطبيق فقط | ✅ |
| `purchase_request_rows` | التطبيق فقط | ✅ (تابعة للطلب) |
| `audit_log` | `supabase/migrations` | ✅ |
| `profiles`, `user_roles` | `supabase/migrations` | ❌ |
| `licenses`, `activations`, `app_bundles`, `heartbeats` | `supabase/migrations` | ❌ |
| `erp_backups` | `supabase/migrations` | ❌ |

---

## 3. المزامنة

```bash
npm run sync          # push ثم pull
npm run sync:push     # المحلي ← Appwrite فقط
npm run sync:pull     # Appwrite ← المحلي فقط
npm run sync:check    # dry-run: يعرض ما سينتقل دون كتابة شيء

node scripts/sync.js --table=items,suppliers   # جدول/جداول محددة
APPWRITE_DEBUG=1 npm run sync                  # سجل مفصّل
```

### Push — كيف يعرف ما لم يُزامَن؟

`electron/db.cjs` **لا** يخزّن صفاً لكل سجل: كل «جدول منطقي» عبارة عن **blob واحد من
JSON** داخل `erp_tables(name, payload)` — فلا وجود لعمود `synced` يمكن قراءته.

لذلك تُنشئ المزامنة جدولها الخاص بجانبه، دون المساس بالـ blobs التي يقرأها التطبيق:

```sql
erp_sync_state(scope, table_name, record_key, doc_id, hash, synced, deleted, remote_updated_at)
erp_sync_meta(key, value)   -- مؤشّر آخر $updatedAt تم سحبه
```

عند كل تشغيل يُحسب هاش لمحتوى كل سجل ويُقارن بالهاش الذي أكّده Appwrite آخر مرة:

- الهاش مختلف → `synced = 0` → يُرفَع
- السجل اختفى محلياً → `deleted = 1, synced = 0` → يُرفَع كـ **حذف ناعم**
- الهاش مطابق → يُتجاهل

الهاش يُحسب على **الإسقاط البعيد** للسجل شاملاً السطور المتداخلة، فتعديلٌ في سطر
واحد داخل أمر شراء يجعل الأمر كله «غير متزامن»، بينما حقل محلي بحت لا يفعل.

### Pull

لكل مجموعة يُسأل Appwrite عن المستندات التي `$updatedAt` فيها أحدث من المؤشّر
المحفوظ، وتُدمج في الـ blob المحلي. المجموعات التابعة (`po_rows` …) تُراقَب على حدة،
لأن تعديل سطر لا يحرّك `$updatedAt` الخاص بأمر الشراء الأب.

الكتابة تتم داخل **transaction** واحدة، والمؤشّر **لا يتقدّم** إذا فشل أي سجل — فتُعاد
محاولته في التشغيل التالي.

### التعارض

`push` يسبق `pull`. فإذا تغيّر السجل نفسه في المكانين، **الإصدار المحلي يفوز**: يُرفَع
أولاً، ثم يرى الـ pull كتابته هو نفسها.

### إعادة المحاولة

كل نداء شبكة يمرّ عبر `withRetry()`: أربع محاولات بـ exponential backoff + jitter،
وفقط للأخطاء العابرة (429 / 408 / 5xx / انقطاع الشبكة). فشل سجل واحد يُسجَّل ويُتخطّى
ولا يُسقط التشغيل كله، ويبقى `synced = 0` ليُعاد في المرة القادمة.

---

## 4. فروق مقصودة عن schema الخاص بـ Supabase

1. **مفاتيح طبيعية بدل UUID.** السجلات المحلية بلا UUID — مفاتيحها
   `supplier.code` و `item.code` و `purchase_order.number`. لذلك تشير السطور
   التابعة إلى أبيها بـ `po_number` لا `po_id`.
2. **`UNIQUE(code)` أصبح `UNIQUE(sync_scope, code)`.** التفرّد العام في Supabase
   ينكسر متى تشارك أكثر من جهاز قاعدة واحدة — وهو نفس التصادم الموثّق في
   `20260729000000_erp_backups.sql`. لذلك يحمل كل مستند `sync_scope`.
3. **`rows[]` و `expenses[]`** مصفوفات متداخلة محلياً، تُفكَّك إلى `po_rows` و
   `po_expenses` مطابقةً لـ Supabase، وتُجمَّع ثانيةً عند الـ pull.
4. **`distribution_type` نص لا enum:** تعليق SQL يقول `cbm/value/qty` بينما
   التطبيق المنشور (`src/lib/erp-types.ts`) يكتب `cbm | percentage | average`.
5. **`po_date` نص لا datetime:** التطبيق يخزّن `YYYY-MM-DD` وحدها، وهي صيغة
   يرفضها حقل datetime في Appwrite.
6. **الحذف حذف ناعم** (`deleted = true`) لا حذف فعلي: الحذف الفعلي غير مرئي
   لجهاز آخر يراقب `$updatedAt` فقط.
7. **جدول `users` المحلي لا يُزامَن إطلاقاً** — يحتوي `passwordHash` و `salt`،
   ونقل مادة اعتماد كهذه إلى السحابة قرار أمني مستقل. `profiles` و `user_roles`
   موجودتان للتكافؤ مع Supabase فقط.
8. **لا مقابل** لـ RLS ولا triggers ولا `set_updated_at` ولا `audit_trigger`:
   Appwrite يوفّر `$createdAt`/`$updatedAt` بنفسه، والصلاحيات على مستوى المجموعة.

---

## 5. ملاحظة تشغيلية: ABI

`better-sqlite3` وحدة native، والنسخة المثبَّتة هنا مبنية لـ **Electron** (وهي التي
تُشحن مع التطبيق). تشغيل `scripts/sync.js` على `node` عادي قد يفشل بخطأ
`NODE_MODULE_VERSION`.

السكريبت يعالج ذلك تلقائياً: عند اكتشاف عدم التطابق يعيد تشغيل نفسه تحت
`ELECTRON_RUN_AS_NODE=1` مستخدماً Electron المثبَّت — فلا يلزمك فعل شيء. وإن لم
يوجد Electron، تظهر رسالة بالبدائل.

---

## 6. الملفات

```
scripts/
├── setup-appwrite.js          إنشاء الـ schema (idempotent)
├── sync.js                    المزامنة push/pull
└── appwrite/
    ├── env.js                 قراءة .env.appwrite والتحقق منه
    ├── client.js              عميل Appwrite
    ├── schema.js              تعريف المجموعات + خرائط التحويل
    ├── local-store.js         SQLite + جدول حالة المزامنة
    ├── sqlite.js              معالجة ABI وإعادة التشغيل تحت Electron
    └── log.js                 السجل + إعادة المحاولة
```
