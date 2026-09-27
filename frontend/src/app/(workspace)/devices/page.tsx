import type { Metadata } from "next";

import { DeviceList } from "@/features/devices";

export const metadata: Metadata = { title: "Пристрої" };

export default function DevicesPage() {
  return <DeviceList />;
}
