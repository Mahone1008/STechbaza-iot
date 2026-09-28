import type { Metadata } from "next";
import { AlarmList } from "@/features/alarms";
export const metadata: Metadata = { title: "Аварії пристрою" };
export default function DeviceAlarmsPage() { return <AlarmList />; }
