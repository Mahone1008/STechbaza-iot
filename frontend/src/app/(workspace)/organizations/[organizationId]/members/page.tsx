import type { Metadata } from "next";
import { OrganizationMembers } from "@/features/organization-members";

export const metadata: Metadata = { title: "Учасники організації" };
export default async function Page({ params }: { params: Promise<{ organizationId: string }> }) {
  return <OrganizationMembers organizationId={(await params).organizationId} />;
}
