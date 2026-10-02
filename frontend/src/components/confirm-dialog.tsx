"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui";
import { ModalDialog } from "./modal-dialog";

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

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = "primary",
  confirmDisabled = false,
  children,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <ModalDialog
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Скасувати
          </Button>
          <Button
            variant={confirmVariant}
            disabled={confirmDisabled}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </ModalDialog>
  );
}
