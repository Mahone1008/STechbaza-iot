import type { Metadata } from "next";

import { AlarmList } from "@/features/alarms";

export const metadata: Metadata = { title: "Аварії" };

export default function AlarmsPage() {
  return <AlarmList />;
}
