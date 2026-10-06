import { notFound } from "next/navigation";
import { StaffConsole } from "@/features/operations/console";

export default function Page() {
  if (process.env.NEXT_PUBLIC_PORTAL_MODE !== "staff") notFound();
  return <StaffConsole />;
}
