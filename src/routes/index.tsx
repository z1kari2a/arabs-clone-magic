import { createFileRoute } from "@tanstack/react-router";
import PurchaseOrderScreen from "@/components/erp/PurchaseOrderScreen";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "أمر شراء - نظام ERP" },
      {
        name: "description",
        content: "شاشة إدارة أوامر الشراء الكاملة مع جدول الأصناف وملخص التكاليف",
      },
      { property: "og:title", content: "أمر شراء - نظام ERP" },
      { property: "og:description", content: "شاشة إدارة أوامر الشراء" },
    ],
  }),
  component: Index,
});

function Index() {
  return <PurchaseOrderScreen />;
}
