import type { Metadata } from "next";
import { NotificationDetail } from "@/features/notification-detail";
export const metadata: Metadata = { title: "Деталі повідомлення" };
export default async function NotificationPage({ params }: { params: Promise<{ organizationId: string; notificationId: string }> }) {
  const { notificationId } = await params;
  return <NotificationDetail notificationId={notificationId} />;
}
