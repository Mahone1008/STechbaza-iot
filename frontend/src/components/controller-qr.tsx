"use client";
import dynamic from "next/dynamic";

export const ControllerQr = dynamic(() => import("./controller-qr-code").then((module) => module.ControllerQrCode), {
  loading: () => <p role="status">Готуємо QR…</p>,
});
