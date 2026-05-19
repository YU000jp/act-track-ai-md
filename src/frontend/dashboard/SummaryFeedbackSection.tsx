import { DashboardSurface } from "./DashboardSurface";

type SummaryFeedbackSectionProps = {
  summaryFeedback: string;
  summaryFeedbackStatus: string;
  onSummaryFeedbackChange: (value: string) => void;
  onGenerateSummaryNow: () => void;
  onSaveSummaryFeedback: () => void;
};

export function SummaryFeedbackSection(props: SummaryFeedbackSectionProps) {
  return (
    <DashboardSurface
      eyebrow="Learning loop"
      title="Summary feedback"
      description="Edit today's AI summary before storing it back into memory."
      class="surface-summary"
      actions={
        <div class="surface-action-group">
          <button type="button" id="generate-summary-now" class="btn-secondary" onClick={props.onGenerateSummaryNow}>
            Generate summary
          </button>
          <button type="button" id="summary-feedback-save" class="btn-primary" onClick={props.onSaveSummaryFeedback}>
            Save feedback
          </button>
        </div>
      }
    >
      <div class="summary-editor">
        <textarea
          id="summary-feedback-input"
          rows={7}
          placeholder="Refine today's summary and keep the correction in memory."
          value={props.summaryFeedback}
          onInput={(event) => props.onSummaryFeedbackChange(event.currentTarget.value)}
        />
        <div id="summary-feedback-status" class="settings-feedback summary-feedback-status" role="status" aria-live="polite">
          {props.summaryFeedbackStatus}
        </div>
      </div>
    </DashboardSurface>
  );
}
