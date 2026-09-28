import type { Metadata } from "next";
import { OrganizationList } from "@/features/inventory";
export const metadata: Metadata = { title: "Організації" };
export default function Page() { return <OrganizationList />; }
