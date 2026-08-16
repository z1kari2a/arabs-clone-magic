// اختبارات النواة الحسابية. لا واجهة ولا متصفح: كل ما يُختبر هنا دوالّ صافية
// (computePO / computePR / parseDecimal / numCell)، فالبيئة `node` أسرع وأصدق —
// هي نفس البيئة التي تكشف اعتماداً خفياً على `window` لو تسلّل إلى نواة الحساب.
import { defineConfig } from "vitest/config";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsConfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
