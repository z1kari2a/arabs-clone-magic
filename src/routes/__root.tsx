import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { toast } from "sonner";

import appCss from "../styles.css?url";
import { Toaster } from "../components/ui/sonner";
import { onStorageFull } from "../lib/local-db";
import { useBranding } from "../lib/branding";
import { installNativeDialogs } from "../lib/native-dialogs";

// Set only by vite.electron.config.mjs, so it is undefined in the web build.
const IS_DESKTOP = import.meta.env.VITE_DESKTOP === "true";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  // الخطأ يُسجَّل في طرفية المتصفّح وحدها: لا يُرسَل إلى أي جهة خارجية. كان
  // هنا نداءٌ يُبلّغ محرّراً خارجياً بالأخطاء، حُذف مع بقيّة ارتباطاته.
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "تسجيل الدخول - نظام ERP" },
      { name: "description", content: "تسجيل الدخول إلى نظام إدارة أوامر الشراء" },
      { name: "author", content: "Fikra Digital" },
      { property: "og:title", content: "تسجيل الدخول - نظام ERP" },
      { property: "og:description", content: "تسجيل الدخول إلى نظام إدارة أوامر الشراء" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "تسجيل الدخول - نظام ERP" },
      { name: "twitter:description", content: "تسجيل الدخول إلى نظام إدارة أوامر الشراء" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // The desktop build runs from file:// with no network: "/favicon.ico"
      // cannot resolve there, and Cairo is bundled locally by
      // electron-app/fonts.css. Keeping these links would make the app wait on
      // requests that can never succeed on an offline machine.
      ...(IS_DESKTOP
        ? []
        : [
            { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
            { rel: "preconnect", href: "https://fonts.googleapis.com" },
            // `as const` مقصود: بدونه يتوسّع النوع إلى `string`، بينما
            // `LinkHTMLAttributes.crossOrigin` اتحادٌ ضيّق — وهو خطأ الأنواع
            // الوحيد الذي كان قائماً في المشروع.
            {
              rel: "preconnect",
              href: "https://fonts.gstatic.com",
              crossOrigin: "anonymous" as const,
            },
            {
              rel: "stylesheet",
              href: "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap",
            },
          ]),
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // The desktop build is client-mounted into #root inside an already-parsed
  // document (electron-app/index.html owns <html>/<head>/<body>). Rendering the
  // shell there makes React 19 adopt the real <html>/<body> as Host Singletons
  // while the root container stays nested inside <body> — its event system then
  // spins forever on the first discrete event and the window hangs on the login
  // screen. Only the SSR web build renders the document itself.
  if (IS_DESKTOP) return <>{children}</>;

  return (
    <html lang="ar" dir="rtl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  // Mounted above every route so a rename applies on whatever screen the user
  // happens to be on — including the login screen, which renders no layout.
  useBranding();
  // فوق كل الشاشات كذلك: `confirm`/`alert` تصيران حوارَي ويندوز أصليَّين في
  // نسخة سطح المكتب، ولا تتغيّران في المتصفح. لا شاشة تحتاج أن تعرف بذلك.
  useEffect(() => installNativeDialogs(), []);

  // One subscriber for every storage write in the app. Browser storage fills up
  // silently — setItem throws and the write just does not happen — so without
  // this the user keeps working in a document that stopped being saved.
  // Desktop writes to SQLite and never hits this.
  useEffect(
    () =>
      onStorageFull(() =>
        toast.error("مساحة التخزين ممتلئة — التغييرات لم تعد تُحفظ", {
          // A fixed id so the 400ms draft autosave cannot stack this toast.
          id: "storage-full",
          duration: Infinity,
          description:
            "صدّر بياناتك ثم احذف أوامر قديمة لتفريغ مساحة. نسخة ويندوز لا تواجه هذا الحد.",
        }),
      ),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      {/* Every screen reports success and failure through toast() — "كلمة المرور
          غير صحيحة", "تم الحفظ", "يجب اختيار المورد". Without this host mounted
          none of them are ever drawn, and the app looks like it ignored the
          click or froze. It belongs here, above all routes, and not inside a
          layout that some screens do not use. */}
      <Toaster
        position="top-center"
        dir="rtl"
        richColors
        closeButton
        duration={5000}
        toastOptions={{ style: { fontFamily: "inherit", textAlign: "right" } }}
      />
    </QueryClientProvider>
  );
}
