"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";

// Зберігаємо геометрію, а не попередні дані: loading/error не скорочують
// документ під користувачем. Резерв скидається при виході з цього пристрою.
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
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  return <div ref={region} className={`stable-region ${className}`}><div ref={content} className="stable-region-content">{children}</div></div>;
}
