import type { ReactElement } from "react";
import { Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

/**
 * قائمة الزر الأيمن على سطر الجدول — خيار واحد: «حذف الصف»، يحذف السطر
 * وبياناته كلّها من الجدول (لا قصّ ولا تفريغ جزئي). تُستعمل في أمر الشراء
 * وطلب الشراء ودليل الأصناف بنفس الشكل.
 *
 * `ContextMenu` جذرٌ بلا عنصر DOM و«المحتوى» يُعرض في Portal، فبنية
 * <tbody><tr> تبقى سليمة رغم التغليف.
 */
export default function RowMenu({
  children,
  onDelete,
  disabled,
  label = "حذف الصف",
}: {
  children: ReactElement;
  onDelete: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={disabled}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[10rem] text-right">
        <ContextMenuItem
          onSelect={onDelete}
          disabled={disabled}
          className="text-rose-600 focus:text-rose-700 gap-2"
        >
          <Trash2 size={13} />
          {label}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
