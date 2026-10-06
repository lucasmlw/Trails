import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../store/auth";
import { useNetwork } from "../store/network";
import { useConfig } from "../store/config";

export function TopBar({ title, children, back }: { title?: string; children?: ReactNode; back?: string }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const { online, pending, syncing, sync } = useNetwork();
  const appName = useConfig((s) => s.config.appName);

  return (
    <header className="topbar">
      {back ? (
        <Link to={back} className="brand" title="Back">
          <span style={{ fontSize: 18 }}>←</span>
        </Link>
      ) : (
        <Link to="/" className="brand">
          <img src="/icons/icon.svg" alt="" />
          <span>{appName}</span>
        </Link>
      )}
      {title && <h1 className="truncate grow">{title}</h1>}
      {!title && <div className="grow" />}
      {children}
      <button
        className={"status-pill" + (online ? "" : " offline")}
        onClick={() => void sync()}
        title={online ? (pending ? `${pending} change(s) waiting to sync – click to sync now` : "Online") : "Offline – downloaded trips remain available"}
        style={{ padding: "4px 9px" }}
      >
        <span className="dot" />
        {syncing ? "Syncing…" : online ? (pending ? `${pending} pending` : "Online") : "Offline"}
      </button>
      {user && (
        <button className="ghost small" onClick={() => void logout()} title={`Signed in as ${user.displayName}`}>
          <span className="truncate" style={{ maxWidth: 90 }}>
            {user.displayName}
          </span>{" "}
          · Logout
        </button>
      )}
    </header>
  );
}
