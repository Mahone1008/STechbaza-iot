import Link from "next/link";
import type { Route } from "next";
import type { Metadata } from "next";

import { UiKitShowcase } from "@/features/ui-kit";

export const metadata: Metadata = { title: "Компоненти" };

export default function UiKitPage() {
  return <><p><Link className="button button-secondary" href={"/ui-kit/device-demo" as Route}>Демонстраційна панель пристрою</Link></p><UiKitShowcase /></>;
}
