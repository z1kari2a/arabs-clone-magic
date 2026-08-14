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

import appCss from "../styles.css?url";
import { Toaster } from "../components/ui/sonner";
import { useBranding } from "../lib/branding";
import { reportLovableError } from "../lib/lovable-error-reporting";

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
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

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
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "تسجيل الدخول - نظام ERP" },
      { property: "og:description", content: "تسجيل الدخول إلى نظام إدارة أوامر الشراء" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "تسجيل الدخول - نظام ERP" },
      { name: "twitter:description", content: "تسجيل الدخول إلى نظام إدارة أوامر الشراء" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/78a08e22-e638-485c-8bca-d71f860a133d/id-preview-3988a8a0--fcee6d02-066c-4ec5-8918-f7362ac0e4e4.lovable.app-1784654489404.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/78a08e22-e638-485c-8bca-d71f860a133d/id-preview-3988a8a0--fcee6d02-066c-4ec5-8918-f7362ac0e4e4.lovable.app-1784654489404.png" },
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
            { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
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
