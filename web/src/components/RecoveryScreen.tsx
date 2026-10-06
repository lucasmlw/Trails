import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { resetLocalData } from "../offline/reset";

interface Props {
  error?: unknown;
}

/**
 * Shown when the app throws during render, or when the user opens /reset.
 * Offers a plain reload and a full wipe of this device's local data.
 */
export function RecoveryScreen({ error }: Props) {
  const [busy, setBusy] = useState(false);
  const message = error instanceof Error ? error.message : error ? String(error) : null;
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>{message ? "Something went wrong" : "Reset this device"}</h1>
        {message && (
          <div className="error-box mb">
            <code style={{ wordBreak: "break-word" }}>{message}</code>
          </div>
        )}
        <p className="small muted">
          Your trips are safe on the server. Try reloading first. If the app still will not open, reset this device: that removes offline maps, local
          photos and any unsynced edits stored on <em>this</em> device only, and signs you out.
        </p>
        <div className="row wrap mt">
          <button className="primary" onClick={() => window.location.replace("/")} disabled={busy}>
            Reload
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={async () => {
              if (!confirm("Remove all offline data stored on this device and sign out?")) return;
              setBusy(true);
              await resetLocalData();
            }}
          >
            {busy ? "Resetting…" : "Reset this device"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface BoundaryState {
  error: unknown;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Unhandled render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) return <RecoveryScreen error={this.state.error} />;
    return this.props.children;
  }
}
