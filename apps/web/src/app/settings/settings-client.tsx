"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  LogOut,
  RefreshCw,
  Save,
} from "lucide-react";
import type { Settings } from "../types/db";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { saveSettingsAction, logoutAction } from "../actions";
import { LLM_PROVIDER_OPTIONS, envVarForProvider } from "@/lib/providers";
import { cn } from "@/lib/utils";

type SettingsForm = Omit<Settings, "id" | "created_at" | "updated_at">;

const ADVANCED_EXPANDED_KEY = "edda-settings-advanced-expanded";

const ADVANCED_FIELDS: (keyof SettingsForm)[] = [
  "approval_new_type",
  "approval_new_entity",
  "approval_archive_stale",
  "approval_merge_entity",
  "cron_runner",
  "sandbox_provider",
  "agents_md_token_budget",
  "agents_md_max_per_category",
  "agents_md_max_versions",
  "agents_md_max_entities",
  "system_prompt_override",
];

// ── Card primitive matching the handoff design ─────────────────────

function SettingsCard({
  title,
  description,
  children,
  footer,
  tone = "default",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  tone?: "default" | "destructive";
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-sm",
        tone === "destructive" &&
          "border-[color:color-mix(in_oklab,var(--destructive)_25%,var(--border))]",
      )}
    >
      <div className="px-6 pt-5 pb-1">
        <h2 className="m-0 text-[16px] font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex flex-col gap-[18px] px-6 pt-4 pb-5">{children}</div>
      {footer && (
        <div className="flex items-center justify-between gap-3 border-t bg-[color:var(--neutral-50)] px-6 py-3 text-[12px] text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  );
}

// ── Form field wrapper ────────────────────────────────────────────

function Field({
  label,
  hint,
  htmlFor,
  action,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={htmlFor}
          className="text-[13px] font-medium text-foreground"
        >
          {label}
        </label>
        {action}
      </div>
      {children}
      {hint && <div className="text-[12px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Row({
  children,
  cols = "1fr 1fr",
}: {
  children: React.ReactNode;
  cols?: string;
}) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: cols }}>
      {children}
    </div>
  );
}

// ── Settings-local select with handoff chevron ─────────────────────

function SettingsSelect({
  id,
  value,
  onChange,
  children,
}: {
  id?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={onChange}
        className="flex h-9 w-full cursor-pointer appearance-none rounded-md border bg-background py-1 pl-3 pr-9 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}

// ── Section side-nav with scroll-spy ──────────────────────────────

type Section = { id: string; label: string };

function useScrollSpy(sections: Section[]) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the section closest to the top of the viewport.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id.replace(/^sec-/, ""));
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 },
    );

    sections.forEach((s) => {
      const el = document.getElementById(`sec-${s.id}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  return active;
}

// ── Main component ───────────────────────────────────────────────

export function SettingsClient({
  initial,
  authEnabled,
  agentNames,
}: {
  initial: Settings;
  authEnabled: boolean;
  agentNames: string[];
}) {
  const [form, setForm] = useState<SettingsForm>(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, created_at, updated_at, ...rest } = initial;
    return rest;
  });
  const [baseline, setBaseline] = useState<SettingsForm>(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, created_at, updated_at, ...rest } = initial;
    return rest;
  });
  const [isPending, startTransition] = useTransition();
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!lastSaved) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [lastSaved]);

  const dirty = useMemo(() => {
    return (Object.keys(baseline) as (keyof SettingsForm)[]).some(
      (k) => !Object.is(form[k], baseline[k]),
    );
  }, [form, baseline]);
  const [advancedOpen, setAdvancedOpen] = useState(() => {
    try {
      return localStorage.getItem(ADVANCED_EXPANDED_KEY) === "true";
    } catch {
      return false;
    }
  });

  function toggleAdvanced() {
    setAdvancedOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ADVANCED_EXPANDED_KEY, String(next));
      } catch {
        /* unavailable */
      }
      return next;
    });
  }

  const providerChanged =
    form.llm_provider !== baseline.llm_provider ||
    form.default_model !== baseline.default_model;
  const embeddingChanged =
    form.embedding_provider !== baseline.embedding_provider ||
    form.embedding_model !== baseline.embedding_model ||
    form.embedding_dimensions !== baseline.embedding_dimensions;

  const timezoneOptions = useMemo(() => {
    const supportedValuesOf = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf;
    const supported =
      typeof supportedValuesOf === "function"
        ? supportedValuesOf("timeZone")
        : [];
    if (supported.length === 0) {
      return form.user_timezone ? [form.user_timezone] : ["UTC"];
    }
    if (form.user_timezone && !supported.includes(form.user_timezone)) {
      return [form.user_timezone, ...supported];
    }
    return supported;
  }, [form.user_timezone]);

  function update<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await saveSettingsAction(form);
        setBaseline(form);
        setLastSaved(new Date());
        toast.success("Settings saved");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save settings");
      }
    });
  }

  const sections: Section[] = useMemo(
    () => [
      { id: "profile", label: "Profile" },
      { id: "llm", label: "LLM Provider" },
      { id: "embeddings", label: "Embeddings" },
      { id: "search", label: "Web Search" },
      { id: "agents", label: "Agents & Concurrency" },
      { id: "advanced", label: "Advanced" },
      ...(authEnabled ? [{ id: "account", label: "Account" } as Section] : []),
    ],
    [authEnabled],
  );
  const activeSection = useScrollSpy(sections);

  const scrollTo = (id: string) => {
    const el = document.getElementById(`sec-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const advancedDirtyCount = useMemo(
    () => ADVANCED_FIELDS.filter((k) => !Object.is(form[k], baseline[k])).length,
    [form, baseline],
  );

  return (
    <main className="min-h-full bg-background">
      <div
        className="grid items-start gap-10 px-6 pt-7 pb-24"
        style={{ gridTemplateColumns: "180px minmax(0, 780px)" }}
      >
        {/* ── Side nav ───────────────────────────────────────── */}
        <aside className="sticky top-7 self-start">
          <div className="mb-7">
            <h1 className="m-0 text-2xl font-bold tracking-tight">Settings</h1>
            <div className="mt-1 font-mono text-[12px] text-muted-foreground">
              edda · local
            </div>
          </div>
          <nav className="flex flex-col gap-px">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={cn(
                  "cursor-pointer rounded-md border-none bg-transparent px-2.5 py-1.5 text-left text-[13px] transition-colors",
                  activeSection === s.id
                    ? "bg-[color:var(--neutral-100)] font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="mt-6 rounded-lg border bg-[color:var(--neutral-50)] px-3 py-2.5">
            <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              Signed in
            </div>
            <div className="mt-1 text-[13px] font-medium">
              {form.user_display_name?.trim() || "Guest"}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                className="block h-[7px] w-[7px] shrink-0 rounded-full bg-signal-ok"
                style={{
                  boxShadow:
                    "0 0 0 3px color-mix(in oklab, var(--signal-ok) 20%, transparent)",
                }}
              />
              {authEnabled ? "Password protected" : "Open access"}
            </div>
          </div>
        </aside>

        {/* ── Content ────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-5">
          {/* Alerts */}
          {providerChanged && (
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                LLM provider/model changes require a server restart to take effect.
              </AlertDescription>
            </Alert>
          )}

          {/* Profile */}
          <div id="sec-profile">
            <SettingsCard
              title="Profile"
              description="How Edda refers to you and renders timestamps."
            >
              <Field
                label="Display name"
                htmlFor="user_display_name"
                hint="Injected into the agent prompt and used in chat."
              >
                <Input
                  id="user_display_name"
                  value={form.user_display_name ?? ""}
                  onChange={(e) =>
                    update("user_display_name", e.target.value || null)
                  }
                />
              </Field>
              <Field
                label="Timezone"
                htmlFor="user_timezone"
                hint="Reminders and cron schedules fire in this timezone."
              >
                <SettingsSelect
                  id="user_timezone"
                  value={form.user_timezone}
                  onChange={(e) => update("user_timezone", e.target.value)}
                >
                  {timezoneOptions.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </SettingsSelect>
              </Field>
            </SettingsCard>
          </div>

          {/* LLM Provider */}
          <div id="sec-llm">
            <SettingsCard
              title="LLM Provider"
              description="The model Edda's agents reason with. Applies to every agent unless overridden."
              footer={
                <>
                  <span className="font-mono">
                    Requires <code>{envVarForProvider(form.llm_provider)}</code>{" "}
                    in the server&apos;s environment.
                  </span>
                  <span className="text-muted-foreground">
                    Changes apply after restart
                  </span>
                </>
              }
            >
              <Row>
                <Field label="Provider" htmlFor="llm_provider">
                  <SettingsSelect
                    id="llm_provider"
                    value={form.llm_provider}
                    onChange={(e) =>
                      update(
                        "llm_provider",
                        e.target.value as Settings["llm_provider"],
                      )
                    }
                  >
                    {LLM_PROVIDER_OPTIONS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </SettingsSelect>
                </Field>
                <Field
                  label="Model"
                  htmlFor="default_model"
                  hint="Must support tool calling."
                >
                  <Input
                    id="default_model"
                    value={form.default_model}
                    onChange={(e) => update("default_model", e.target.value)}
                    className="font-mono text-[13px]"
                  />
                </Field>
              </Row>
            </SettingsCard>
          </div>

          {/* Embeddings */}
          <div id="sec-embeddings">
            <SettingsCard
              title="Embeddings"
              description="Used to vectorize items for semantic recall. Changing provider or dimensions requires re-embedding."
            >
              <Row cols="1fr 1fr 120px">
                <Field label="Provider" htmlFor="embedding_provider">
                  <SettingsSelect
                    id="embedding_provider"
                    value={form.embedding_provider}
                    onChange={(e) =>
                      update(
                        "embedding_provider",
                        e.target.value as Settings["embedding_provider"],
                      )
                    }
                  >
                    <option value="voyage">Voyage</option>
                    <option value="openai">OpenAI</option>
                    <option value="google">Google</option>
                  </SettingsSelect>
                </Field>
                <Field label="Model" htmlFor="embedding_model">
                  <Input
                    id="embedding_model"
                    value={form.embedding_model}
                    onChange={(e) => update("embedding_model", e.target.value)}
                    className="font-mono text-[13px]"
                  />
                </Field>
                <Field label="Dimensions" htmlFor="embedding_dimensions">
                  <Input
                    id="embedding_dimensions"
                    type="number"
                    value={form.embedding_dimensions}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") return;
                      const n = Number(v);
                      if (Number.isFinite(n) && n > 0) update("embedding_dimensions", n);
                    }}
                    className="font-mono text-[13px]"
                  />
                </Field>
              </Row>
              {embeddingChanged && (
                <div
                  className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5"
                  style={{
                    background:
                      "color-mix(in oklab, var(--accent-warm) 8%, var(--background))",
                    borderColor:
                      "color-mix(in oklab, var(--accent-warm) 30%, var(--border))",
                  }}
                >
                  <RefreshCw
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--accent-warm)]"
                    aria-hidden
                  />
                  <div className="text-[12px] text-foreground">
                    Changing the provider or dimensions will require a full
                    re-embedding. Run{" "}
                    <code className="font-mono text-[11.5px]">
                      npx tsx src/scripts/re-embed.ts
                    </code>{" "}
                    from <code className="font-mono text-[11.5px]">apps/server</code>{" "}
                    after saving.
                  </div>
                </div>
              )}
            </SettingsCard>
          </div>

          {/* Web Search */}
          <div id="sec-search">
            <SettingsCard
              title="Web Search"
              description="Configure the search provider. Add web_search to an agent's tools to enable it."
            >
              <Row cols="1fr 140px">
                <Field label="Provider" htmlFor="search_provider">
                  <SettingsSelect
                    id="search_provider"
                    value={form.search_provider}
                    onChange={(e) =>
                      update(
                        "search_provider",
                        e.target.value as Settings["search_provider"],
                      )
                    }
                  >
                    <option value="brave">Brave (free tier available)</option>
                    <option value="tavily">Tavily</option>
                    <option value="duckduckgo">DuckDuckGo (no key, unreliable)</option>
                    <option value="serper">Serper</option>
                    <option value="serpapi">SerpAPI</option>
                  </SettingsSelect>
                </Field>
                <Field
                  label="Max results"
                  htmlFor="web_search_max_results"
                  hint="1–50"
                >
                  <Input
                    id="web_search_max_results"
                    type="number"
                    min={1}
                    max={50}
                    value={form.web_search_max_results}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") return;
                      const n = Number(v);
                      if (Number.isFinite(n) && n > 0) update("web_search_max_results", n);
                    }}
                    className="font-mono text-[13px]"
                  />
                </Field>
              </Row>
            </SettingsCard>
          </div>

          {/* Agents & Concurrency */}
          <div id="sec-agents">
            <SettingsCard
              title="Agents & Concurrency"
              description="Runtime defaults for every agent task run."
            >
              <Row>
                <Field
                  label="Default agent"
                  htmlFor="default_agent"
                  hint="The agent used as the primary conversational interface."
                >
                  <SettingsSelect
                    id="default_agent"
                    value={form.default_agent}
                    onChange={(e) => update("default_agent", e.target.value)}
                  >
                    {agentNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </SettingsSelect>
                </Field>
                <Field
                  label="Max concurrent tasks"
                  htmlFor="task_max_concurrency"
                  hint={`Parallel task cap (1–10). Currently: ${form.task_max_concurrency}`}
                >
                  <div className="flex h-9 items-center gap-3">
                    <input
                      type="range"
                      id="task_max_concurrency"
                      min={1}
                      max={10}
                      step={1}
                      value={form.task_max_concurrency}
                      onChange={(e) =>
                        update("task_max_concurrency", Number(e.target.value))
                      }
                      className="flex-1"
                      style={{ accentColor: "var(--primary)" }}
                    />
                    <div className="min-w-9 rounded bg-[color:var(--neutral-100)] px-2 py-1 text-center font-mono text-[13px] font-semibold">
                      {form.task_max_concurrency}
                    </div>
                  </div>
                </Field>
              </Row>

              <div className="border-t pt-4">
                <div className="mb-2.5 section-eyebrow">Registered agents</div>
                {agentNames.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    No agents yet.
                  </p>
                ) : (
                  <div className="flex flex-col">
                    {agentNames.map((name) => (
                      <Link
                        key={name}
                        href={`/agents/${encodeURIComponent(name)}`}
                        className="grid grid-cols-[140px_1fr_auto] items-center gap-3.5 border-b border-[color:var(--neutral-100)] px-1 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[color:var(--neutral-50)]"
                      >
                        <div className="truncate font-mono text-[13px] font-medium">
                          {name}
                        </div>
                        <div className="truncate text-[13px] text-muted-foreground">
                          {name === form.default_agent
                            ? "Default conversational agent"
                            : "Edit configuration, tools, schedules"}
                        </div>
                        {name === form.default_agent ? (
                          <span className="rounded border px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                            default
                          </span>
                        ) : (
                          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                            edit
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </SettingsCard>
          </div>

          {/* Advanced */}
          <div id="sec-advanced">
            <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <button
                type="button"
                onClick={toggleAdvanced}
                className="flex w-full cursor-pointer items-center gap-2.5 border-none bg-transparent px-6 py-4 text-left"
              >
                {advancedOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <div className="flex-1">
                  <div className="text-[16px] font-semibold tracking-tight">
                    Advanced
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">
                    Approvals, sandbox, memory budgets, system prompt override.
                  </div>
                </div>
                {!advancedOpen && advancedDirtyCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md border bg-[color:var(--accent-warm-soft)] px-2 py-0.5 font-mono text-[11px] font-medium text-[color:var(--accent-warm)]">
                    {advancedDirtyCount} unsaved
                  </span>
                )}
              </button>
              {advancedOpen && (
                <div className="flex flex-col gap-5 border-t px-6 py-5">
                  {/* Approvals */}
                  <div>
                    <div className="mb-2.5 section-eyebrow">Approvals</div>
                    <Row>
                      <Field
                        label="New item types"
                        htmlFor="approval_new_type"
                        hint="Whether new item types require confirmation."
                      >
                        <SettingsSelect
                          id="approval_new_type"
                          value={form.approval_new_type}
                          onChange={(e) =>
                            update(
                              "approval_new_type",
                              e.target.value as Settings["approval_new_type"],
                            )
                          }
                        >
                          <option value="auto">Auto-approve</option>
                          <option value="confirm">Require confirmation</option>
                        </SettingsSelect>
                      </Field>
                      <Field
                        label="New entities"
                        htmlFor="approval_new_entity"
                        hint="Whether new entities require confirmation."
                      >
                        <SettingsSelect
                          id="approval_new_entity"
                          value={form.approval_new_entity}
                          onChange={(e) =>
                            update(
                              "approval_new_entity",
                              e.target.value as Settings["approval_new_entity"],
                            )
                          }
                        >
                          <option value="auto">Auto-approve</option>
                          <option value="confirm">Require confirmation</option>
                        </SettingsSelect>
                      </Field>
                    </Row>
                    <div className="mt-4">
                      <Row>
                        <Field
                          label="Archive stale items"
                          htmlFor="approval_archive_stale"
                        >
                          <SettingsSelect
                            id="approval_archive_stale"
                            value={form.approval_archive_stale}
                            onChange={(e) =>
                              update(
                                "approval_archive_stale",
                                e.target.value as Settings["approval_archive_stale"],
                              )
                            }
                          >
                            <option value="auto">Auto-approve</option>
                            <option value="confirm">Require confirmation</option>
                          </SettingsSelect>
                        </Field>
                        <Field
                          label="Merge entities"
                          htmlFor="approval_merge_entity"
                        >
                          <SettingsSelect
                            id="approval_merge_entity"
                            value={form.approval_merge_entity}
                            onChange={(e) =>
                              update(
                                "approval_merge_entity",
                                e.target.value as Settings["approval_merge_entity"],
                              )
                            }
                          >
                            <option value="auto">Auto-approve</option>
                            <option value="confirm">Require confirmation</option>
                          </SettingsSelect>
                        </Field>
                      </Row>
                    </div>
                  </div>

                  {/* Execution */}
                  <div className="border-t pt-4">
                    <div className="mb-2.5 section-eyebrow">Execution</div>
                    <Row>
                      <Field
                        label="Cron runner"
                        htmlFor="cron_runner"
                        hint="Local node-cron or LangGraph platform triggers."
                      >
                        <SettingsSelect
                          id="cron_runner"
                          value={form.cron_runner}
                          onChange={(e) =>
                            update(
                              "cron_runner",
                              e.target.value as Settings["cron_runner"],
                            )
                          }
                        >
                          <option value="local">Local (node-cron)</option>
                          <option value="langgraph">LangGraph Platform</option>
                        </SettingsSelect>
                      </Field>
                      <Field
                        label="Sandbox provider"
                        htmlFor="sandbox_provider"
                        hint="Enables shell execution for agents with the coding skill."
                      >
                        <SettingsSelect
                          id="sandbox_provider"
                          value={form.sandbox_provider}
                          onChange={(e) =>
                            update(
                              "sandbox_provider",
                              e.target.value as Settings["sandbox_provider"],
                            )
                          }
                        >
                          <option value="none">Disabled</option>
                          <option value="node-vfs">
                            Node VFS (in-memory, dev only)
                          </option>
                        </SettingsSelect>
                      </Field>
                    </Row>
                  </div>

                  {/* Budgets */}
                  <div className="border-t pt-4">
                    <div className="mb-2.5 section-eyebrow">AGENTS.md budgets</div>
                    <Row cols="1fr 1fr 1fr 1fr">
                      <Field
                        label="Token budget"
                        htmlFor="agents_md_token_budget"
                      >
                        <Input
                          id="agents_md_token_budget"
                          type="number"
                          value={form.agents_md_token_budget}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "") return;
                            const n = Number(v);
                            if (Number.isFinite(n) && n > 0)
                              update("agents_md_token_budget", n);
                          }}
                          className="font-mono text-[13px]"
                        />
                      </Field>
                      <Field
                        label="Per category"
                        htmlFor="agents_md_max_per_category"
                      >
                        <Input
                          id="agents_md_max_per_category"
                          type="number"
                          value={form.agents_md_max_per_category}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "") return;
                            const n = Number(v);
                            if (Number.isFinite(n) && n > 0)
                              update("agents_md_max_per_category", n);
                          }}
                          className="font-mono text-[13px]"
                        />
                      </Field>
                      <Field
                        label="Max versions"
                        htmlFor="agents_md_max_versions"
                      >
                        <Input
                          id="agents_md_max_versions"
                          type="number"
                          value={form.agents_md_max_versions}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "") return;
                            const n = Number(v);
                            if (Number.isFinite(n) && n > 0)
                              update("agents_md_max_versions", n);
                          }}
                          className="font-mono text-[13px]"
                        />
                      </Field>
                      <Field
                        label="Max entities"
                        htmlFor="agents_md_max_entities"
                      >
                        <Input
                          id="agents_md_max_entities"
                          type="number"
                          value={form.agents_md_max_entities}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "") return;
                            const n = Number(v);
                            if (Number.isFinite(n) && n > 0)
                              update("agents_md_max_entities", n);
                          }}
                          className="font-mono text-[13px]"
                        />
                      </Field>
                    </Row>
                  </div>

                  {/* System prompt override */}
                  <div className="border-t pt-4">
                    <Field
                      label="System prompt override"
                      htmlFor="system_prompt_override"
                      hint="Prepended to the built-in system prompt for every agent. Leave empty to use the default."
                    >
                      <textarea
                        id="system_prompt_override"
                        rows={4}
                        className="flex w-full rounded-md border bg-transparent px-3 py-2 font-mono text-[12.5px] leading-[1.6] shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={form.system_prompt_override ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          update(
                            "system_prompt_override",
                            v.trim() === "" ? null : v,
                          );
                        }}
                      />
                    </Field>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Account (only when auth enabled) */}
          {authEnabled && (
            <div id="sec-account">
              <SettingsCard
                title="Account"
                description="Session and destructive actions."
                tone="destructive"
              >
                <form
                  action={logoutAction}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-3"
                >
                  <div className="flex items-center gap-3">
                    <LogOut
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden
                    />
                    <div>
                      <div className="text-[13px] font-medium">Log out</div>
                      <div className="text-[12px] text-muted-foreground">
                        Ends this browser session. Scheduled agents keep running.
                      </div>
                    </div>
                  </div>
                  <Button variant="outline" size="sm">
                    Log out
                  </Button>
                </form>
              </SettingsCard>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 pt-2 font-mono text-[12px] text-muted-foreground">
            <span>
              {dirty
                ? "Unsaved changes"
                : lastSaved
                  ? `Last saved ${formatRelative(lastSaved)}`
                  : "All changes saved"}
            </span>
            <span>edda · settings</span>
          </div>
        </div>
      </div>

      {/* Sticky save bar */}
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur transition-all duration-300 ease-in-out supports-[backdrop-filter]:bg-background/80",
          dirty
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-full opacity-0",
        )}
      >
        <div className="flex items-center justify-between gap-3 px-6 py-3">
          <p className="text-sm text-muted-foreground">
            You have unsaved changes
          </p>
          <Button
            onClick={handleSave}
            disabled={isPending}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </main>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function formatRelative(d: Date): string {
  const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
