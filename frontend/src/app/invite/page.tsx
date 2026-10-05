import type { Metadata } from "next";
import { InvitationPage } from "@/features/invitation";

export const metadata: Metadata = { title: "Запрошення" };
export default function Page() { return <InvitationPage />; }
