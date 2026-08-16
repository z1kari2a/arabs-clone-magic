import { useCallback, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { AlertTriangle, Save, FileClock, LogOut, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * حارس زر «إغلاق».
 *
 * زر الإغلاق كان ينفّذ `history.back()` فوراً: بلا سؤال، وبلا فرصة لحفظ ما
 * كُتب في الشاشة، ومع سلوك صامت إذا لم يكن هناك تاريخ تصفح قبله (أول شاشة
 * فُتحت في البرنامج). هذا الحارس يعالج الثلاثة معاً:
 *
 *  1. يسأل دائماً قبل الإغلاق.
 *  2. يعرض «حفظ وإغلاق» و«حفظ كمسودة» عندما تكون هناك بيانات غير محفوظة.
 *  3. يعود إلى الشاشة السابقة، أو إلى «الرئيسية» إن لم توجد شاشة سابقة.
 */
export type CloseGuardOptions = {
  /** هل توجد بيانات غير محفوظة تستحق السؤال عن حفظها. */
  dirty?: boolean;
  /**
   * الحفظ النهائي (نفس زر «حفظ»). يُعيد `false` إذا رفض الحفظ — تحقّق ناقص
   * مثلاً — فتبقى الشاشة مفتوحة بدل أن تُغلق وتضيع البيانات.
   */
  onSave?: () => boolean | void | Promise<boolean | void>;
  /** حفظ كمسودّة: بلا أي تحقّق، وتُستعاد البيانات تلقائياً عند العودة للشاشة. */
  onSaveDraft?: () => void;
  /** يُستدعى عند «إغلاق بدون حفظ» — لمسح المسودّة حتى لا تعود بعد رفضها. */
  onDiscard?: () => void;
  /** اسم الشاشة كما يظهر في نص السؤال. */
  title?: string;
};

export function useCloseGuard(opts: CloseGuardOptions) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { dirty = false, onSave, onSaveDraft, onDiscard, title } = opts;

  const requestClose = useCallback(() => setOpen(true), []);

  const leave = useCallback(() => {
    setOpen(false);
    // شاشة فُتحت مباشرةً (لا تاريخ تصفح قبلها) كان زر الإغلاق فيها لا يفعل
    // شيئاً على الإطلاق — نأخذ المستخدم إلى الرئيسية بدل أن يبقى عالقاً.
    if (window.history.length > 1) window.history.back();
    else void router.navigate({ to: "/home" });
  }, [router]);

  const saveAndLeave = useCallback(async () => {
    if (!onSave) return leave();
    setBusy(true);
    try {
      const ok = await onSave();
      if (ok === false) { setOpen(false); return; } // الحفظ رفض — تبقى الشاشة
      leave();
    } finally {
      setBusy(false);
    }
  }, [onSave, leave]);

  const draftAndLeave = useCallback(() => {
    onSaveDraft?.();
    leave();
  }, [onSaveDraft, leave]);

  const discardAndLeave = useCallback(() => {
    onDiscard?.();
    leave();
  }, [onDiscard, leave]);

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <AlertTriangle size={18} className={dirty ? "text-amber-500" : "text-slate-400"} />
            {dirty ? "إغلاق مع وجود بيانات غير محفوظة" : "إغلاق الشاشة"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600 leading-6">
          {dirty
            ? <>هناك بيانات لم تُحفظ في {title ? <b>{title}</b> : "هذه الشاشة"}. ماذا تريد أن نفعل بها قبل الإغلاق؟</>
            : <>هل تريد إغلاق {title ? <b>{title}</b> : "هذه الشاشة"} والعودة إلى الشاشة السابقة؟</>}
        </p>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          {dirty && onSave && (
            <Button onClick={saveAndLeave} disabled={busy} className="gap-1">
              <Save size={14} /> حفظ وإغلاق
            </Button>
          )}
          {dirty && onSaveDraft && (
            <Button onClick={draftAndLeave} disabled={busy} variant="secondary" className="gap-1">
              <FileClock size={14} /> حفظ كمسودّة وإغلاق
            </Button>
          )}
          <Button onClick={discardAndLeave} disabled={busy} variant={dirty ? "destructive" : "default"} className="gap-1">
            <LogOut size={14} /> {dirty ? "إغلاق بدون حفظ" : "إغلاق"}
          </Button>
          <Button onClick={() => setOpen(false)} disabled={busy} variant="outline" className="gap-1">
            <Undo2 size={14} /> إلغاء
          </Button>
        </DialogFooter>
        {dirty && onSaveDraft && (
          <p className="text-[11px] text-slate-500 leading-5">
            المسودّة تُحفظ على هذا الجهاز لحسابك وحده، وتُستعاد تلقائياً عند فتح الشاشة مرّة أخرى.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );

  return { requestClose, dialog, pending: open };
}
