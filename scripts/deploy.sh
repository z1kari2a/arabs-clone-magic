#!/usr/bin/env bash
# نشر التطبيق على https://fikradigital.online
# البناء ← إعادة تشغيل خدمة pm2 (erp) ← فحص أن الموقع يرد.
# nginx يمرّر fikradigital.online إلى localhost:8080، و pm2 يشغّل .output/server/index.mjs هناك.
set -euo pipefail

cd "$(dirname "$0")/.."
SITE="https://fikradigital.online"

echo "▶ البناء…"
npm run build

echo "▶ إعادة التشغيل (pm2: erp)…"
pm2 restart erp --update-env >/dev/null

# انتظر حتى يرد الموقع فعلاً — إعادة التشغيل تاخذ لحظة، والفحص الفوري يكذب.
echo -n "▶ التحقق من $SITE "
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$SITE/" || true)
  if [ "$code" = "200" ]; then
    echo "→ ✅ 200 (المحاولة $i)"
    pm2 describe erp | grep -E "status|uptime" | head -2
    exit 0
  fi
  echo -n "."
  sleep 1
done

echo "→ ❌ الموقع ما ردّش (آخر رمز: ${code:-none})"
pm2 logs erp --lines 30 --nostream
exit 1
