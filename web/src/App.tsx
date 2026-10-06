import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./store/auth";
import { useConfig } from "./store/config";
import { startNetworkMonitor } from "./store/network";
import { useToasts } from "./store/toast";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { TripPage } from "./pages/TripPage";
import { NavigationPage } from "./pages/NavigationPage";
import { ErrorBoundary, RecoveryScreen } from "./components/RecoveryScreen";

function RequireAuth({ children }: { children: React.ReactElement }) {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === "loading") {
    return (
      <div className="login-wrap">
        <span className="spinner" />
      </div>
    );
  }
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function Toasts() {
  const { toasts, dismiss } = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const init = useAuth((s) => s.init);
  const status = useAuth((s) => s.status);
  const loadConfig = useConfig((s) => s.load);

  useEffect(() => {
    void init();
    startNetworkMonitor();
  }, [init]);

  useEffect(() => {
    if (status === "authenticated") void loadConfig();
  }, [status, loadConfig]);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/reset" element={<RecoveryScreen />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/trips/:id"
            element={
              <RequireAuth>
                <TripPage />
              </RequireAuth>
            }
          />
          <Route
            path="/trips/:id/navigate"
            element={
              <RequireAuth>
                <NavigationPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toasts />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
