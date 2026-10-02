import { ConnectPage } from "@/features/connect";
export default async function Page({ params }: { params: Promise<{ controllerId: string }> }) { const { controllerId } = await params; return <ConnectPage id={controllerId} />; }
