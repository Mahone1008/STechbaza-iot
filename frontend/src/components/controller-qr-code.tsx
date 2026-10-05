"use client";
import { useEffect, useId, useMemo } from "react";
import qrcode from "qrcode-generator";

export function ControllerQrCode({
  url,
  label = "QR для підключення контролера",
  onReady,
}: {
  url: string;
  label?: string;
  onReady?: (url: string) => void;
}) {
  const titleId = useId();
  const qr = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(url);
    code.make();
    const size = code.getModuleCount();
    const parts: string[] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) if (code.isDark(y, x)) parts.push(`M${x + 4},${y + 4}h1v1h-1z`);
    return { size: size + 8, path: parts.join("") };
  }, [url]);
  useEffect(() => {
    onReady?.(url);
  }, [url, onReady]);
  return (
    <svg
      className="controller-qr"
      role="img"
      aria-labelledby={titleId}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      width="220"
      height="220"
      shapeRendering="crispEdges"
    >
      <title id={titleId}>{label}</title>
      <path fill="white" d={`M0 0h${qr.size}v${qr.size}H0z`} />
      <path fill="#102b40" d={qr.path} />
    </svg>
  );
}
