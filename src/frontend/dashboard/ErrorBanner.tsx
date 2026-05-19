import { describeAppError } from "../../shared/app-error";
import type { DashboardErrorState } from "./types";

type ErrorBannerProps = {
  errorState: DashboardErrorState | null;
};

export function ErrorBanner(props: ErrorBannerProps) {
  return (
    <div
      id="app-error-banner"
      class="error-banner"
      role="alert"
      aria-live="assertive"
      hidden={!props.errorState}
      data-error-kind={props.errorState?.error.kind}
      data-error-command={props.errorState?.error.command}
    >
      {props.errorState ? (
        <>
          <strong>Dashboard issue</strong>
          <span>{describeAppError(props.errorState.error, props.errorState.context)}</span>
        </>
      ) : (
        ""
      )}
    </div>
  );
}
