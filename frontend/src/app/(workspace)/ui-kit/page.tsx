import type { Metadata } from "next";

import { UiKitShowcase } from "@/features/ui-kit";

export const metadata: Metadata = { title: "Компоненти" };

export default function UiKitPage() {
  return <UiKitShowcase />;
}
