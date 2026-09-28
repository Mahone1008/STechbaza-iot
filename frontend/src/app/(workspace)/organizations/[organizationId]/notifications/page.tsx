import type { Metadata } from "next";
import { NotificationFeed } from "@/features/notifications";
export const metadata: Metadata = { title: "Повідомлення організації" };
export default function NotificationsPage() { return <NotificationFeed />; }
