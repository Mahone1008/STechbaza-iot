import type { Metadata } from "next";
import { AlarmDetail } from "@/features/alarm-detail";
export const metadata: Metadata = { title: "Деталі інциденту" };
export default async function AlarmPage({ params }: { params: Promise<{ deviceId: string; alarmId: string }> }) {
  const { alarmId } = await params;
  return <AlarmDetail alarmId={alarmId} />;
}
