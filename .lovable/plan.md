# تحويل ERP إلى نظام إنتاجي حقيقي

## الهدف
معالجة العيوب الحرجة الأربعة: قاعدة بيانات حقيقية، مصادقة حقيقية، صلاحيات مفروضة، سجل تدقيق تفصيلي.

---

## 1. تفعيل Lovable Cloud
تفعيل الـ Cloud → PostgreSQL + Auth + Storage + Edge Functions.

## 2. مخطط قاعدة البيانات (Migration واحد)

**جداول المصادقة والصلاحيات:**
- `profiles` — البريد، الاسم، تاريخ الإنشاء (foreign key → auth.users)
- `app_role` enum — `admin`, `user`, `viewer`
- `user_roles` — جدول منفصل للأدوار (منع privilege escalation)
- `has_role()` — دالة SECURITY DEFINER

**قاعدة "أول مستخدم = Admin":**
- Trigger على auth.users بعد INSERT → ينشئ profile + يعطي دور Admin لأول مستخدم و User للباقين

**جداول العمل:**
- `suppliers` — الموردون
- `items` — دليل الأصناف (مع الوحدات كـ JSONB)
- `purchase_orders` — رأس أوامر الشراء
- `po_rows` — بنود الأوامر
- `po_expenses` — مصروفات الأوامر
- `audit_log` — تفصيلي: user_id, action, table_name, record_id, before (jsonb), after (jsonb), timestamp

**سياسات RLS:**
- القراءة: كل مستخدم مسجّل (`authenticated`)
- الكتابة/التعديل: Admin أو User فقط
- الحذف: Admin فقط
- الاعتماد (approve): Admin فقط
- Viewer: قراءة فقط
- `audit_log`: قراءة للـ Admin، كتابة تلقائية من triggers

**Triggers للـ Audit:**
- AFTER INSERT/UPDATE/DELETE على كل الجداول التجارية → يسجّل في audit_log مع before/after JSON

## 3. طبقة الوصول للبيانات
استبدال `erp-store.ts` بـ:
- `src/lib/erp-api.functions.ts` — server functions محمية بـ `requireSupabaseAuth`
- استخدام TanStack Query (`useSuspenseQuery` + `ensureQueryData` في loaders)
- كل عملية كتابة تمر عبر server function تتحقق من الدور

## 4. المصادقة
- استبدال شاشة `/` (login وهمي) بـ:
  - `/auth` — تسجيل دخول/تسجيل حساب حقيقي (email + password)
  - Password HIBP check مفعّل
- `_authenticated/` layout للصفحات المحمية
- نقل كل شاشات ERP تحت `_authenticated/`
- تحديث ErpLayout ليقرأ من `supabase.auth.getUser()`

## 5. فرض الصلاحيات في الـ UI
- إخفاء أزرار الحذف/الاعتماد عن Viewer
- إخفاء شاشة "المستخدمون" عن غير Admin
- إظهار badge للدور في شريط الحالة

## 6. شاشة سجل التدقيق
- إضافة `/audit-log` (Admin فقط)
- عرض جدول: التاريخ، المستخدم، العملية، الجدول، معرّف السجل، عرض قبل/بعد كـ dialog JSON

## 7. الحفاظ على التصميم الحالي
لا تغيير في مظهر الـ ERP (الشريط الأزرق، الـ Ribbon، الأبعاد، الاختصارات). فقط تبديل مصدر البيانات وطبقة الأمان.

---

## الملفات المتأثرة (تقريبياً 20 ملف)
- **جديد**: migration SQL كبير، `erp-api.functions.ts`، `audit-log.tsx`، `_authenticated/route.tsx` (تلقائي من الـ integration)
- **تعديل**: كل ملفات الـ routes الحالية (نقلها + استبدال store)، `ErpLayout.tsx`، `index.tsx` (login)
- **حذف**: `erp-store.ts` القديم (localStorage)، `users.tsx` القديم (استبدال بإدارة عبر Supabase Auth)

## ملاحظة مهمة
لن يتم ترحيل بيانات localStorage الحالية (بيانات تجريبية). النظام يبدأ نظيفاً.

## التنفيذ
سيتم على 3 دفعات:
1. Cloud + Migration + Auth
2. تحويل الـ store + الشاشات + فرض الصلاحيات
3. شاشة Audit Log + اختبار end-to-end
