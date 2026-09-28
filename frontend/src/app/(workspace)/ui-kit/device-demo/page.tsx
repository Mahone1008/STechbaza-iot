import { DeviceDashboard } from "@/features/devices";
import { getDevice } from "@/lib/demo-data";
export default function Page() { return <><div className="notice notice-warning">Демонстраційна панель: усі показання та стани вигадані. Команди не надсилаються.</div><DeviceDashboard device={getDevice("north-pump")} /></>; }
