"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Click-to-edit text primitive.
 *
 * Displays `value` as plain text. Clicking switches to an input (or
 * textarea if `multiline`) with autofocus. Enter saves; Escape reverts.
 * Calls `onSave(next)` which the caller wires to a server action.
 *
 * While saving, the field is disabled. Errors bubble up via thrown
 * exceptions from `onSave` — the caller handles toast feedback.
 */
export function InlineText({
  value,
  onSave,
  placeholder,
  multiline = false,
  className,
  inputClassName,
  displayClassName,
  ariaLabel,
  rows = 3,
  mono = false,
  disabled = false,
}: {
  value: string;
  onSave: (next: string) => void | Promise<void>;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  inputClassName?: string;
  displayClassName?: string;
  ariaLabel?: string;
  rows?: number;
  mono?: boolean;
  disabled?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [pending, setPending] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  React.useEffect(() => {
    if (editing) {
      const el = multiline ? areaRef.current : inputRef.current;
      el?.focus();
      if (el && "select" in el) el.select();
    }
  }, [editing, multiline]);

  const commit = async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setPending(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      // Caller surfaces error; keep editor open so user can retry.
    } finally {
      setPending(false);
    }
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setEditing(true)}
        aria-label={ariaLabel ?? "Edit"}
        className={cn(
          "group w-full text-left",
          "rounded-sm -mx-1 px-1",
          !disabled &&
            "cursor-text hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
          className,
        )}
      >
        <span
          className={cn(
            "block whitespace-pre-wrap",
            !value && "text-muted-foreground italic",
            mono && "font-mono text-[0.8125rem]",
            displayClassName,
          )}
        >
          {value || placeholder || "—"}
        </span>
      </button>
    );
  }

  if (multiline) {
    return (
      <textarea
        ref={areaRef}
        rows={rows}
        value={draft}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void commit();
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(
          "w-full resize-y rounded-sm border border-ring bg-background px-1 py-0.5",
          "text-sm focus:outline-none",
          mono && "font-mono text-[0.8125rem]",
          className,
          inputClassName,
        )}
      />
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      disabled={pending}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
        if (e.key === "Enter") {
          e.preventDefault();
          void commit();
        }
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn(
        "w-full rounded-sm border border-ring bg-background px-1 py-0.5",
        "text-sm focus:outline-none",
        mono && "font-mono text-[0.8125rem]",
        className,
        inputClassName,
      )}
    />
  );
}
