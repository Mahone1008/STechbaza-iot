"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";

// Зберігаємо геометрію, а не попередні дані: loading/error не скорочують
// документ під користувачем. Резерв належить поточній ширині; його можна
// відпустити після запиту або явного згортання details.
export function StableRegion({ children, className = "", preserveHeight = true }: { children: ReactNode; className?: string; preserveHeight?: boolean }) {
  const region = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const measured = useRef({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const outer = region.current!, inner = content.current!;
    const measure = (release = false) => {
      const bounds = inner.getBoundingClientRect();
      const sameWidth = Math.abs(bounds.width - measured.current.width) < 1;
      const height = preserveHeight && sameWidth && !release
        ? Math.max(measured.current.height, Math.ceil(bounds.height))
        : Math.ceil(bounds.height);
      measured.current = { width: bounds.width, height };
      outer.style.minHeight = `${height}px`;
    };
    const onToggle = (event: Event) => {
      const disclosure = event.target;
      if (!(disclosure instanceof HTMLDetailsElement) || disclosure.open || !inner.contains(disclosure)) return;
      measure(true);
    };
    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(inner);
    // Native toggle does not bubble. Capture handles mouse and keyboard equally;
    // a disclosure removed by a loading/error render must not release the reserve.
    inner.addEventListener("toggle", onToggle, true);
    return () => { observer.disconnect(); inner.removeEventListener("toggle", onToggle, true); };
  }, [preserveHeight]);
  return <div ref={region} className={`stable-region ${className}`}><div ref={content} className="stable-region-content">{children}</div></div>;
}
