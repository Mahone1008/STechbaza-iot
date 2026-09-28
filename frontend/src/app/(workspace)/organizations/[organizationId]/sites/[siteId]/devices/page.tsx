import type { Metadata } from "next";
import { DeviceList } from "@/features/inventory";
export const metadata: Metadata = { title: "Пристрої" };
export default function Page() { return <DeviceList />; }
