import { createSignal } from "solid-js";
import type { SummaryGenerationReport } from "../../shared/types";
import type { DashboardClient } from "./tauri-bridge";
import type { DashboardToast } from "./types";
import type { MemoryController } from "./useMemoryController";

type UseSummaryControllerProps = {
  rpc: DashboardClient;
  memoryController: Pick<MemoryController, "refreshMemorySnapshot">;
  reportError: (context: string, error: unknown) => void;
  pushToast: (kind: DashboardToast["kind"], title: string, message: string) => void;
};

export type SummaryController = {
  summaryFeedback: () => string;
  summaryFeedbackStatus: () => string;
  setSummaryFeedback: (value: string) => void;
  setSummaryFeedbackStatus: (value: string) => void;
  hydrateSummary: (summary: string | null | undefined) => void;
  generateSummaryNow: () => Promise<void>;
  saveSummaryFeedback: () => Promise<void>;
};

export function useSummaryController(props: UseSummaryControllerProps): SummaryController {
  const [summaryFeedback, setSummaryFeedback] = createSignal("");
  const [summaryFeedbackStatus, setSummaryFeedbackStatus] = createSignal("");

  function hydrateSummary(summary: string | null | undefined): void {
    setSummaryFeedback(summary ?? "");
    setSummaryFeedbackStatus("");
  }

  async function generateSummaryNow(): Promise<void> {
    try {
      const report: SummaryGenerationReport = await props.rpc.generateSummaryNow();
      setSummaryFeedback(report.summary.aiSummary ?? "");
      setSummaryFeedbackStatus(
        report.aiSummaryError
          ? `Generated with AI fallback: ${report.aiSummaryError.message}`
          : "Summary generated and exported.",
      );
      await props.memoryController.refreshMemorySnapshot();
      props.pushToast(
        "info",
        "Summary generated",
        report.aiSummaryError ? "Exported without AI summary." : "Summary was generated and exported.",
      );
    } catch (error) {
      props.reportError("Failed to generate summary", error);
    }
  }

  async function saveSummaryFeedback(): Promise<void> {
    try {
      const date = new Date().toISOString().slice(0, 10);
      await props.rpc.saveSummaryFeedback({ date, editedSummary: summaryFeedback().trim() });
      setSummaryFeedbackStatus("Saved as learning feedback.");
      await props.memoryController.refreshMemorySnapshot();
      props.pushToast("success", "Feedback saved", "Learning feedback was stored.");
    } catch (error) {
      props.reportError("Failed to save summary feedback", error);
    }
  }

  return {
    summaryFeedback,
    summaryFeedbackStatus,
    setSummaryFeedback,
    setSummaryFeedbackStatus,
    hydrateSummary,
    generateSummaryNow,
    saveSummaryFeedback,
  };
}
