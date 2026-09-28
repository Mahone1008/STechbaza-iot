import type { Metadata } from "next";
import { DeviceIdentity } from "@/features/inventory";
export const metadata: Metadata = { title: "Пристрій" };
export default function DevicePage() { return <DeviceIdentity />; }
