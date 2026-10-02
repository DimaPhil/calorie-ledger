import { useEffect, useRef, useState } from "react";
import { useI18n, localizeError } from "./i18n.js";

export function ExportData() {
  const { t, language } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function download(format: "csv" | "markdown") {
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/export?format=${format}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(
          result.error?.message || result.error || "Export failed.",
        );
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `calorie-ledger-export.${format === "csv" ? "zip" : "md"}`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Export failed.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <details className="panel export-panel">
      <summary>{t("Export data", "Экспорт данных")}</summary>
      <p>
        {t(
          "Download all recorded history, regardless of the chart interval: daily nutrition, journal entries, foods, dishes, targets and check-ins. Missing values remain blank, with completeness flags for analysis.",
          "Скачайте всю историю независимо от периода графиков: питание по дням, записи журнала, продукты, блюда, цели и отметки. Неизвестные значения остаются пустыми; полнота данных указана отдельно.",
        )}
      </p>
      <p>
        {t(
          "CSV contains separate tables in a ZIP archive. Markdown is one report, ready to share with an AI. Deleted entries and sign-in credentials are excluded.",
          "CSV — отдельные таблицы в ZIP-архиве. Markdown — единый отчёт для анализа с ИИ. Удалённые записи и данные для входа не включены.",
        )}
      </p>
      <div className="export-actions">
        <button disabled={busy} onClick={() => void download("csv")}>
          {t("Download CSV (.zip)", "Скачать CSV (.zip)")}
        </button>
        <button disabled={busy} onClick={() => void download("markdown")}>
          {t("Download Markdown", "Скачать Markdown")}
        </button>
      </div>
      {busy && (
        <p role="status">{t("Preparing export…", "Подготовка экспорта…")}</p>
      )}
      {error && <p role="alert">{localizeError(error, language)}</p>}
    </details>
  );
}
