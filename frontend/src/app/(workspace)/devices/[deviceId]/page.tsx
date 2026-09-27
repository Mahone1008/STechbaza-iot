import type { Metadata } from "next";

import { DeviceDashboard } from "@/features/devices";
import { getDevice } from "@/lib/demo-data";

export const metadata: Metadata = { title: "Панель пристрою" };

type DevicePageProps = {
  params: Promise<{ deviceId: string }>;
};

export default async function DevicePage({ params }: DevicePageProps) {
  const { deviceId } = await params;
  return <DeviceDashboard device={getDevice(deviceId)} />;
}
