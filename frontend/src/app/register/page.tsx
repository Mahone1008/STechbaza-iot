import type { Metadata } from "next";
import { RegistrationPage } from "@/features/registration";

export const metadata: Metadata = { title: "Створення облікового запису" };
export default function Page() { return <RegistrationPage />; }
