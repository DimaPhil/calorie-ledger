import { useEffect, useRef, useState } from "react";
import { useI18n, localizeError } from "./i18n.js";
import { analysisPrompt } from "./analysis-prompt.js";

export function ExportData() {
  const { t, language } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState<"copied" | "manual" | null>(
    null,
  );
  const promptField = useRef<HTMLTextAreaElement>(null);
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(analysisPrompt);
      setCopyStatus("copied");
    } catch {
      promptField.current?.focus();
      promptField.current?.select();
      setCopyStatus("manual");
    }
  }
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
      <details className="analysis-prompt">
        <summary>
          {t("AI nutrition analysis prompt", "Промпт для анализа питания с ИИ")}
        </summary>
        <p>
          {t(
            "Attach your export to GPT-6 Pro and paste this prompt. It asks for a concise 4–8 week plan with specific meals, variety and Bay Area shopping ideas. Add your current training, preferences and constraints before sending. The same prompt is included in both downloads.",
            "Прикрепите экспорт к GPT-6 Pro и вставьте этот промпт. Он запрашивает краткий план на 4–8 недель с конкретными блюдами, разнообразием и покупками в Bay Area. Перед отправкой добавьте актуальные тренировки, предпочтения и ограничения. Тот же промпт включён в оба формата экспорта.",
          )}
        </p>
        <label>
          <span className="sr-only">
            {t("Analysis prompt", "Промпт для анализа")}
          </span>
          <textarea
            ref={promptField}
            readOnly
            rows={12}
            value={analysisPrompt}
            spellCheck={false}
          />
        </label>
        <button onClick={() => void copyPrompt()}>
          {t("Copy prompt", "Скопировать промпт")}
        </button>
        {copyStatus && (
          <p role="status">
            {copyStatus === "copied"
              ? t("Prompt copied.", "Промпт скопирован.")
              : t(
                  "Text selected. Copy it manually using your device’s copy command.",
                  "Текст выделен. Скопируйте его вручную на вашем устройстве.",
                )}
          </p>
        )}
      </details>
      {busy && (
        <p role="status">{t("Preparing export…", "Подготовка экспорта…")}</p>
      )}
      {error && <p role="alert">{localizeError(error, language)}</p>}
    </details>
  );
}
