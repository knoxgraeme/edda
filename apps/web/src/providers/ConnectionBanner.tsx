"use client";

/**
 * Connectivity banner — polls the backend and shows a warning when unreachable.
 */

import { useState, useEffect } from "react";

export function ConnectionBanner() {
  const [serverDown, setServerDown] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function checkHealth() {
      try {
        const res = await fetch("/api/v1/settings", { method: "GET" });
        if (cancelled) return;
        if (res.ok) {
          setServerDown(false);
          setDismissed(false);
        } else {
          setServerDown(true);
        }
      } catch {
        if (!cancelled) setServerDown(true);
      }
    }
    checkHealth();
    const interval = setInterval(checkHealth, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!serverDown || dismissed) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-300/50 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200">
      <span>
        Server unavailable &mdash; make sure the backend is running on port 8000
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded px-2 py-0.5 text-xs font-medium hover:bg-amber-200/50 dark:hover:bg-amber-800/50"
        aria-label="Dismiss connectivity warning"
      >
        Dismiss
      </button>
    </div>
  );
}
