import { Component, type ReactNode } from "react";
import { clearLocal } from "../state/persist";

function startOver() {
  clearLocal();
  // Drop any #p= share link too, so a plan that crashes can't come straight back.
  window.location.replace(window.location.pathname + window.location.search);
}

/** A render error would otherwise leave a blank page — on every reload, since the plan autosaves. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Windeye</h1>
        <p>Something went wrong while drawing this plan.</p>
        <p className="crash-detail">{error.message}</p>
        <div className="crash-actions">
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button type="button" className="primary" onClick={startOver}>
            Start over with a fresh plan
          </button>
        </div>
        <p className="muted small">Starting over forgets the plan saved in this browser.</p>
      </div>
    );
  }
}
