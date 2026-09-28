import type { Metadata } from "next";
import { DeviceOverview } from "@/features/device-overview";
export const metadata: Metadata = { title: "Пристрій" };
export default function DevicePage() { return <DeviceOverview />; }
