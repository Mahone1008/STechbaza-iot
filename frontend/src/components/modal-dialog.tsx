"use client";
import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

type ModalDialogProps = {
  open: boolean;
  title: string;
  description: string;
  children?: ReactNode;
  actions: ReactNode;
  className?: string;
  initialFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
};

export function ModalDialog({
  open,
  title,
  description,
  children,
  actions,
  className = "",
  initialFocus,
  onClose,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId(),
    descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      initialFocus?.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
    // Закриття до вилучення вузла повертає фокус на кнопку, що відкрила діалог.
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open, initialFocus]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    // Strict Mode може закрити й одразу відкрити той самий dialog у dev.
    const close = () => {
      if (!dialog.open) onClose();
    };
    dialog.addEventListener("cancel", cancel);
    dialog.addEventListener("close", close);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("close", close);
    };
  }, [onClose]);
  return (
    <dialog
      className={`dialog ${className}`}
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        // Modal робить фон inert; Tab не виходить у browser chrome або приховані дні календаря.
        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]"),
        ).filter(
          (element) => !element.matches(":disabled") && element.tabIndex >= 0 && element.getClientRects().length > 0,
        );
        const first = focusable[0],
          last = focusable.at(-1);
        if (first && last && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }}
    >
      <header className="dialog-header">
        <h2 className="dialog-title" id={titleId}>
          {title}
        </h2>
        <p className="dialog-description" id={descriptionId}>
          {description}
        </p>
      </header>
      {children ? <div className="dialog-body">{children}</div> : null}
      <footer className="dialog-actions">{actions}</footer>
    </dialog>
  );
}
