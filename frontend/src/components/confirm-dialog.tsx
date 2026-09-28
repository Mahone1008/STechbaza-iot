"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  confirmVariant?: "primary" | "danger";
  children?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({ open, title, description, confirmLabel, confirmVariant = "primary", confirmDisabled = false, children, onConfirm, onClose }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => { event.preventDefault(); onClose(); };
    const handleClose = () => onClose();
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
    };
  }, [onClose]);

  return (
    <dialog className="dialog" ref={dialogRef} aria-labelledby={titleId} aria-describedby={descriptionId}>
      <header className="dialog-header"><h2 className="dialog-title" id={titleId}>{title}</h2><p className="dialog-description" id={descriptionId}>{description}</p></header>
      {children ? <div className="dialog-body">{children}</div> : null}
      <footer className="dialog-actions">
        <Button variant="secondary" onClick={onClose}>Скасувати</Button>
        <Button variant={confirmVariant} disabled={confirmDisabled} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
      </footer>
    </dialog>
  );
}
