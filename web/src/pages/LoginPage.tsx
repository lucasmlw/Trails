import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../store/auth";
import { useConfig } from "../store/config";
import { isNative, apiBase, setApiBase } from "../api/client";

export function LoginPage() {
  const { status, login } = useAuth();
  const appName = useConfig((s) => s.config.appName);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState(apiBase());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (status === "authenticated") return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isNative()) setApiBase(server);
      await login(username.trim(), password);
      await useConfig.getState().load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo">
          <img src="/icons/icon.svg" alt="" />
          <div>
            <h1>{appName}</h1>
            <div className="tiny muted">Private route planner</div>
          </div>
        </div>
        {isNative() && (
          <div className="field">
            <label>Server address</label>
            <input type="text" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://trails.example.com" autoCapitalize="none" />
          </div>
        )}
        <div className="field">
          <label htmlFor="username">Username</label>
          <input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        {error && <div className="error-box mb">{error}</div>}
        <button type="submit" className="primary" disabled={busy} style={{ width: "100%", padding: 11 }}>
          {busy ? "Signing in…" : "Login"}
        </button>
        <div className="tiny muted center mt">Accounts are set up by the server administrator.</div>
      </form>
    </div>
  );
}
