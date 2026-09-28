"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";

// Зберігаємо геометрію, а не попередні дані: loading/error не скорочують
// документ під користувачем. Явне згортання details скидає резерв до
// поточної висоти; заміна контенту під час запиту його зберігає.
export function StableRegion({ children, className = "" }: { children: ReactNode; className?: string }) {
  const region = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const outer = region.current!, inner = content.current!;
    let height = 0;
    const measure = () => {
      height = Math.max(height, Math.ceil(inner.getBoundingClientRect().height));
      outer.style.minHeight = `${height}px`;
    };
    const onToggle = (event: Event) => {
      const disclosure = event.target;
      if (!(disclosure instanceof HTMLDetailsElement) || disclosure.open || !inner.contains(disclosure)) return;
      height = Math.ceil(inner.getBoundingClientRect().height);
      outer.style.minHeight = `${height}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    // Native toggle does not bubble. Capture handles mouse and keyboard equally;
    // a disclosure removed by a loading/error render must not release the reserve.
    inner.addEventListener("toggle", onToggle, true);
    return () => { observer.disconnect(); inner.removeEventListener("toggle", onToggle, true); };
  }, []);
  return <div ref={region} className={`stable-region ${className}`}><div ref={content} className="stable-region-content">{children}</div></div>;
}
