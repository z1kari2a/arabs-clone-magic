// إعداد Vite صريح للبناء الويب/SSR (TanStack Start + nitro).
//
// كان هذا الملف يستورد `defineConfig` من حزمة وسيطة تخفي كل ما تحته؛ صار كل
// شيء مكتوباً هنا كي لا يعتمد بناءُ المشروع على حزمة خارجية تختار عنه إضافاته
// وخياراته. ما يلي هو نفس ما كانت تركّبه، بلا ما يخصّ محرّراً خارجياً (جسر
// خادم التطوير، وبوابة HMR، ووكيل الأصول، ومرسِلات الأخطاء إلى قناة المحرّر).
//
// بناء نسخة ويندوز له ملفه المستقل: vite.electron.config.mjs.
import { defineConfig, loadEnv, type PluginOption, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import path from "node:path";

export default defineConfig(async ({ command, mode }): Promise<UserConfig> => {
  const root = process.cwd();

  const plugins: PluginOption[] = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // كودُ العميل لا يجوز أن يستورد ملفات الخادم: الاستيراد الخاطئ يُوقف
      // البناء بدل أن يتسرّب سرٌّ إلى الحزمة المرسَلة إلى المتصفّح.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      // نقطة دخول الخادم: src/server.ts. الهدف (node-server) يحدّده preset
      // الخاص بـ nitro أدناه — المفتاح `target` لم يعد من خيارات هذه الإضافة.
      server: { entry: "server" },
    }),
    react(),
  ];

  // nitro يعمل في البناء فقط — خادم التطوير يخدمه TanStack Start نفسه.
  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    plugins.push(nitro({ preset: "node-server" }));
  }

  // متغيّرات VITE_* تُحقن صراحةً لتصل إلى كود الخادم أيضاً، لا إلى المتصفّح وحده.
  const env = loadEnv(mode, root, "VITE_");
  const define = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  );

  return {
    define,
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": path.resolve(root, "src") },
      // نسخة واحدة من React ومن طبقة الاستعلامات: نسختان تكسران الـ hooks
      // بأخطاء غامضة ("invalid hook call") يصعب ردّها إلى سببها.
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    plugins,
    // مسارات أصول نسبية: الحزمة نفسها تعمل على الويب وداخل Electron من file://.
    base: "./",
    server: {
      host: "::",
      port: 8080,
      allowedHosts: [".trycloudflare.com"],
    },
  };
});
