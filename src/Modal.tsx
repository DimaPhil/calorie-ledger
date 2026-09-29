import { useEffect, type ReactNode } from "react";
import { useI18n } from "./i18n.js";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector("dialog")!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("input,select,textarea")?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = oldOverflow;
      old?.focus();
    };
  }, []);
  return (
    <dialog
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button
          onClick={onClose}
          aria-label={t("Close dialog", "Закрыть окно")}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
