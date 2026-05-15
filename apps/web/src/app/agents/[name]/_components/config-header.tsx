"use client";

import * as React from "react";

/**
 * Sticky "Configuration" eyebrow that anchors the top of the config
 * column. Kept minimal — just the label bar, no layout switcher for
 * now (we ship one layout, not five).
 */
export function ConfigHeader() {
  return (
    <div className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-muted/30 px-6 py-2.5 backdrop-blur-sm">
      <div className="section-eyebrow">Configuration</div>
    </div>
  );
}
