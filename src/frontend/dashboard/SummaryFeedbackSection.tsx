type SummaryFeedbackSectionProps = {
  summaryFeedback: string;
  summaryFeedbackStatus: string;
  onSummaryFeedbackChange: (value: string) => void;
  onGenerateSummaryNow: () => void;
  onSaveSummaryFeedback: () => void;
};

export function SummaryFeedbackSection(props: SummaryFeedbackSectionProps) {
  return (
    <div id="summary-feedback" class="card">
      <h3>Summary Feedback</h3>
      <button type="button" id="generate-summary-now" class="btn-save" onClick={props.onGenerateSummaryNow}>
        Generate Summary Now
      </button>
      <textarea
        id="summary-feedback-input"
        rows={4}
        placeholder="Edit today's AI summary and save to memory"
        value={props.summaryFeedback}
        onInput={(event) => props.onSummaryFeedbackChange(event.currentTarget.value)}
      />
      <button type="button" id="summary-feedback-save" onClick={props.onSaveSummaryFeedback}>
        Save Feedback
      </button>
      <div id="summary-feedback-status" class="settings-feedback" role="status" aria-live="polite">
        {props.summaryFeedbackStatus}
      </div>
    </div>
  );
}
