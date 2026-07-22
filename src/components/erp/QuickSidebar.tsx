import { Link, useRouterState, useSearch } from "@tanstack/react-router";
import {
  Home,
  ClipboardList,
  Building2,
  Package,
  BarChart3,
  Wallet,
  Users,
  Settings,
  ShieldCheck,
  LogOut,
  PanelRightClose,
  type LucideIcon,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

type SidebarItem = {
  id: string;
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  search?: { tab: string };
  color?: string;
};

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: "home", to: "/home", label: "الرئيسية", icon: Home },
  { id: "po", to: "/purchase-order", label: "أمر الشراء", icon: ClipboardList },
  { id: "suppliers", to: "/suppliers", label: "الموردون", icon: Building2 },
  { id: "items", to: "/items", label: "الأصناف", icon: Package },
  { id: "reports", to: "/reports", label: "التقارير", icon: BarChart3 },
  {
    id: "expenses",
    to: "/reports",
    label: "المصروفات",
    icon: Wallet,
    search: { tab: "expenses" },
    color: "text-orange-600",
  },
  { id: "users", to: "/users", label: "المستخدمون", icon: Users },
  { id: "settings", to: "/settings", label: "الإعدادات", icon: Settings },
  {
    id: "audit",
    to: "/audit-log",
    label: "سجل التدقيق",
    icon: ShieldCheck,
    adminOnly: true,
  },
];

export function QuickSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useSearch({ strict: false }) as { tab?: string };
  const { role, signOut } = useAuth();

  const isActive = (item: SidebarItem) => {
    if (item.id === "expenses") {
      return pathname === "/reports" && search.tab === "expenses";
    }
    if (item.id === "reports") {
      return pathname === "/reports" && search.tab !== "expenses";
    }
    return pathname === item.to || pathname.startsWith(`${item.to}/`);
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className="h-full w-14 flex-shrink-0 flex flex-col bg-slate-100 text-slate-700 border-l border-slate-300 shadow-[inset_-1px_0_0_rgba(0,0,0,0.04)]"
        aria-label="الشريط الجانبي"
      >
        <div className="flex items-center justify-center h-8 border-b border-slate-300 bg-slate-200/70">
          <span className="text-[9px] font-bold text-slate-500">اختصارات</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-1 space-y-1">
          {SIDEBAR_ITEMS.filter((item) => !item.adminOnly || role === "admin").map(
            (item) => {
              const active = isActive(item);
              const Icon = item.icon;
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    <Link
                      to={item.to}
                      search={item.search}
                      className={cn(
                        "flex items-center justify-center w-full h-10 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
                        active
                          ? "bg-blue-100 text-blue-700 border border-blue-300 shadow-sm"
                          : "hover:bg-white hover:text-slate-900",
                        !active && item.color ? item.color : ""
                      )}
                      aria-label={item.label}
                    >
                      <Icon size={20} />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent
                    side="left"
                    align="center"
                    className="text-xs bg-slate-800 text-white border-slate-700"
                  >
                    <p>{item.label}</p>
                  </TooltipContent>
                </Tooltip>
              );
            }
          )}
        </nav>

        <div className="p-1 border-t border-slate-300">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => signOut()}
                className="flex items-center justify-center w-full h-10 rounded-md text-rose-600 hover:bg-rose-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                aria-label="تسجيل الخروج"
              >
                <LogOut size={20} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="left"
              align="center"
              className="text-xs bg-slate-800 text-white border-slate-700"
            >
              <p>تسجيل الخروج</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}
