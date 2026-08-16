// يجعل `confirm()` و`alert()` تفتحان حوار ويندوز الأصلي بدل حوار المتصفح.
//
// عملية Electron الرئيسية تبذل جهداً كبيراً كي لا يبدو البرنامج صفحة ويب: قائمة
// عربية أصلية، قائمة سياق أصلية، حظر F5 وCtrl+R، ومنع أي تنقّل خارج التطبيق.
// ثم يأتي `confirm("حذف أمر الشراء؟")` في الشاشات فيفتح حوار Chromium بشكله
// الويبي ويهدم ذلك كله في لحظة.
//
// الجسر يعرض `confirmSync`/`alertSync` منذ البداية (electron/preload.cjs)، وكان
// تعليقٌ هناك يحيل تركيبهما إلى ملف `entry.tsx` — وهو ملف غير موجود في المستودع
// أصلاً. فالنيّة كانت مكتوبة والتوصيل لم يحدث قط. هذا الملف هو التوصيل.
//
// لماذا الاستبدال العام بدل تعديل مواضع الاستدعاء التسعة: `confirm` تُستدعى في
// شاشات متفرّقة، وكل شاشة جديدة ستستدعيها بالعادة نفسها. الاستبدال هنا يجعل
// السلوك الصحيح هو الافتراضي، لا شيئاً يجب أن يتذكّره كاتب كل شاشة.
//
// خارج نسخة سطح المكتب لا جسر أصلاً، فتبقى دوال المتصفح كما هي — وهو الصحيح
// هناك.

let installed = false;

export function installNativeDialogs(): void {
  if (installed || typeof window === "undefined") return;
  const bridge = window.erpNative;
  if (!bridge?.confirmSync || !bridge?.alertSync) return;

  const { confirmSync, alertSync } = bridge;
  // متزامنتان عمداً: مواضع الاستدعاء كلها من شكل `if (!confirm(...)) return;`،
  // وتحويلها إلى وعود يعني إعادة كتابة كل معالج حذف وحفظ في البرنامج.
  window.confirm = (message?: string) => confirmSync(String(message ?? ""));
  window.alert = (message?: string) => {
    alertSync(String(message ?? ""));
  };
  installed = true;
}
