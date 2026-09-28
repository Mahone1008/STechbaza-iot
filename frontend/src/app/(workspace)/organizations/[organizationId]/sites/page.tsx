import type { Metadata } from "next";
import { SiteList } from "@/features/inventory";
export const metadata: Metadata = { title: "Об’єкти" };
export default function Page() { return <SiteList />; }
