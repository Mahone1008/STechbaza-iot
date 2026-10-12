import type { Metadata } from "next";
import { OrganizationMembers } from "@/features/organization-members";

export const metadata: Metadata = { title: "Учасники та доступ" };
export default async function Page({ params }: { params: Promise<{ organizationId: string }> }) {
  return <OrganizationMembers organizationId={(await params).organizationId} />;
}
