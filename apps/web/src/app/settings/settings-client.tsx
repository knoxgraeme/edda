"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Save, AlertTriangle, RefreshCw, LogOut, ChevronDown } from "lucide-react";
import type { Settings } from "../types/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { saveSettingsAction, logoutAction } from "../actions";
import { LLM_PROVIDER_OPTIONS } from "@/lib/providers";

type SettingsForm = Omit<Settings, "id" | "created_at" | "updated_at">;

const ADVANCED_EXPANDED_KEY = "edda-settings-advanced-expanded";

function FieldGroup({
  label,
  htmlFor,
  children,
  description,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  description?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

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
  const [isPending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(() => {
    try {
      return localStorage.getItem(ADVANCED_EXPANDED_KEY) === "true";
    } catch {
      return false;
    }
  });

  function toggleAdvanced() {
    setAdvancedExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ADVANCED_EXPANDED_KEY, String(next));
      } catch {
        // localStorage unavailable
      }
      return next;
    });
  }

  const providerChanged =
    form.llm_provider !== initial.llm_provider ||
    form.default_model !== initial.default_model;
  const embeddingChanged =
    form.embedding_provider !== initial.embedding_provider ||
    form.embedding_model !== initial.embedding_model;
  const timezoneOptions = useMemo(() => {
    const supportedValuesOf = (Intl as unknown as {
      supportedValuesOf?: (key: string) => string[];
    }).supportedValuesOf;
    const supported = typeof supportedValuesOf === "function"
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
    setDirty(true);
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await saveSettingsAction(form);
        setDirty(false);
        toast.success("Settings saved");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save settings");
      }
    });
  }

  return (
    <main className="max-w-3xl mx-auto p-6 pb-24">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      {providerChanged && (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            LLM provider/model changes require a server restart to take effect.
          </AlertDescription>
        </Alert>
      )}

      {embeddingChanged && (
        <Alert variant="warning" className="mb-4">
          <RefreshCw className="h-4 w-4" />
          <AlertDescription>
            Changing the embedding provider requires re-embedding all items.
            Run <code className="text-xs font-mono">npx tsx src/scripts/re-embed.ts</code> after saving.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6">
        {/* ===== General Section ===== */}

        {/* Profile */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FieldGroup label="Display Name" htmlFor="user_display_name">
              <Input
                id="user_display_name"
                value={form.user_display_name ?? ""}
                onChange={(e) => update("user_display_name", e.target.value || null)}
              />
            </FieldGroup>
            <FieldGroup label="Timezone" htmlFor="user_timezone">
              <Select
                id="user_timezone"
                value={form.user_timezone}
                onChange={(e) => update("user_timezone", e.target.value)}
              >
                {timezoneOptions.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone}
                  </option>
                ))}
              </Select>
            </FieldGroup>
          </CardContent>
        </Card>

        {/* LLM */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">LLM Provider</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FieldGroup label="Provider" htmlFor="llm_provider">
              <Select
                id="llm_provider"
                value={form.llm_provider}
                onChange={(e) => update("llm_provider", e.target.value as Settings["llm_provider"])}
              >
                {LLM_PROVIDER_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </Select>
            </FieldGroup>
            <FieldGroup label="Model" htmlFor="default_model">
              <Input
                id="default_model"
                value={form.default_model}
                onChange={(e) => update("default_model", e.target.value)}
              />
            </FieldGroup>
          </CardContent>
        </Card>

        {/* Embeddings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Embeddings</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FieldGroup label="Provider" htmlFor="embedding_provider">
              <Select
                id="embedding_provider"
                value={form.embedding_provider}
                onChange={(e) =>
                  update("embedding_provider", e.target.value as Settings["embedding_provider"])
                }
              >
                <option value="voyage">Voyage</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
              </Select>
            </FieldGroup>
            <FieldGroup label="Model" htmlFor="embedding_model">
              <Input
                id="embedding_model"
                value={form.embedding_model}
                onChange={(e) => update("embedding_model", e.target.value)}
              />
            </FieldGroup>
            <FieldGroup label="Dimensions" htmlFor="embedding_dimensions">
              <Input
                id="embedding_dimensions"
                type="number"
                value={form.embedding_dimensions}
                onChange={(e) => update("embedding_dimensions", Number(e.target.value))}
              />
            </FieldGroup>
          </CardContent>
        </Card>

        {/* Search */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Web Search</CardTitle>
            <p className="text-sm text-muted-foreground">
              Configure the search provider. Add &quot;web_search&quot; to an
              agent&apos;s tools to enable it.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FieldGroup label="Provider" htmlFor="search_provider">
              <Select
                id="search_provider"
                value={form.search_provider}
                onChange={(e) =>
                  update("search_provider", e.target.value as Settings["search_provider"])
                }
              >
                <option value="brave">Brave (free tier available)</option>
                <option value="tavily">Tavily</option>
                <option value="duckduckgo">DuckDuckGo (no API key, unreliable)</option>
                <option value="serper">Serper</option>
                <option value="serpapi">SerpAPI</option>
              </Select>
            </FieldGroup>
            <FieldGroup label="Max Results" htmlFor="web_search_max_results">
              <Input
                id="web_search_max_results"
                type="number"
                value={form.web_search_max_results}
                onChange={(e) => update("web_search_max_results", Number(e.target.value))}
              />
            </FieldGroup>
          </CardContent>
        </Card>

        {/* Agents & Concurrency */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agents & Concurrency</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FieldGroup
              label="Default Agent"
              htmlFor="default_agent"
              description="The agent used as the primary conversational interface"
            >
              <Select
                id="default_agent"
                value={form.default_agent}
                onChange={(e) => update("default_agent", e.target.value)}
              >
                {agentNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </FieldGroup>
            <FieldGroup
              label="Max concurrent tasks"
              htmlFor="task_max_concurrency"
              description="Maximum number of agent tasks running in parallel (1-10)"
            >
              <Input
                id="task_max_concurrency"
                type="number"
                min={1}
                max={10}
                value={form.task_max_concurrency}
                onChange={(e) => update("task_max_concurrency", Number(e.target.value))}
              />
            </FieldGroup>
          </CardContent>
        </Card>

        {/* ===== Advanced Section Toggle ===== */}
        <button
          type="button"
          onClick={toggleAdvanced}
          className="flex items-center gap-2 py-3 px-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${
              advancedExpanded ? "rotate-0" : "-rotate-90"
            }`}
          />
          Advanced Settings
        </button>

        {/* ===== Advanced Section (collapsible) ===== */}
        <div
          className={`grid gap-6 transition-all duration-300 ease-in-out ${
            advancedExpanded
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="grid gap-6">
              {/* Cron Runner */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Scheduled Tasks</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <FieldGroup label="Cron runner" htmlFor="cron_runner">
                    <Select
                      id="cron_runner"
                      value={form.cron_runner}
                      onChange={(e) =>
                        update("cron_runner", e.target.value as Settings["cron_runner"])
                      }
                    >
                      <option value="in_process">In-process (node-cron)</option>
                      <option value="http_trigger">HTTP trigger (external scheduler)</option>
                      <option value="langgraph">LangGraph Platform</option>
                    </Select>
                  </FieldGroup>
                </CardContent>
              </Card>

              {/* Sandbox */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Sandbox Execution</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Enable shell execution for agents with the &quot;coding&quot; skill.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <FieldGroup label="Provider" htmlFor="sandbox_provider">
                    <Select
                      id="sandbox_provider"
                      value={form.sandbox_provider}
                      onChange={(e) =>
                        update("sandbox_provider", e.target.value as Settings["sandbox_provider"])
                      }
                    >
                      <option value="none">Disabled</option>
                      <option value="node-vfs">Node VFS (in-memory, dev only)</option>
                    </Select>
                  </FieldGroup>
                </CardContent>
              </Card>

              {/* Approvals */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Approval Modes</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <FieldGroup
                    label="New item types"
                    htmlFor="approval_new_type"
                    description="Whether new item types require confirmation"
                  >
                    <Select
                      id="approval_new_type"
                      value={form.approval_new_type}
                      onChange={(e) =>
                        update("approval_new_type", e.target.value as Settings["approval_new_type"])
                      }
                    >
                      <option value="auto">Auto-approve</option>
                      <option value="confirm">Require confirmation</option>
                    </Select>
                  </FieldGroup>
                  <FieldGroup
                    label="Archive stale items"
                    htmlFor="approval_archive_stale"
                    description="Whether archiving stale items requires confirmation"
                  >
                    <Select
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
                    </Select>
                  </FieldGroup>
                  <FieldGroup
                    label="Merge entities"
                    htmlFor="approval_merge_entity"
                    description="Whether entity merges require confirmation"
                  >
                    <Select
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
                    </Select>
                  </FieldGroup>
                </CardContent>
              </Card>

              {/* Budgets & Limits */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Budgets & Limits</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <FieldGroup label="AGENTS.md token budget" htmlFor="agents_md_token_budget">
                    <Input
                      id="agents_md_token_budget"
                      type="number"
                      value={form.agents_md_token_budget}
                      onChange={(e) => update("agents_md_token_budget", Number(e.target.value))}
                    />
                  </FieldGroup>
                  <FieldGroup label="Max per category" htmlFor="agents_md_max_per_category">
                    <Input
                      id="agents_md_max_per_category"
                      type="number"
                      value={form.agents_md_max_per_category}
                      onChange={(e) =>
                        update("agents_md_max_per_category", Number(e.target.value))
                      }
                    />
                  </FieldGroup>
                  <FieldGroup label="Max AGENTS.md versions" htmlFor="agents_md_max_versions">
                    <Input
                      id="agents_md_max_versions"
                      type="number"
                      value={form.agents_md_max_versions}
                      onChange={(e) =>
                        update("agents_md_max_versions", Number(e.target.value))
                      }
                    />
                  </FieldGroup>
                  <FieldGroup label="Max entities in AGENTS.md" htmlFor="agents_md_max_entities">
                    <Input
                      id="agents_md_max_entities"
                      type="number"
                      value={form.agents_md_max_entities}
                      onChange={(e) =>
                        update("agents_md_max_entities", Number(e.target.value))
                      }
                    />
                  </FieldGroup>
                </CardContent>
              </Card>

              {/* System Prompt */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">System Prompt Override</CardTitle>
                </CardHeader>
                <CardContent>
                  <FieldGroup
                    label="Custom system prompt"
                    htmlFor="system_prompt_override"
                    description="Leave empty to use the default. This is prepended to the built-in system prompt."
                  >
                    <textarea
                      id="system_prompt_override"
                      rows={4}
                      className="flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={form.system_prompt_override ?? ""}
                      onChange={(e) =>
                        update("system_prompt_override", e.target.value || null)
                      }
                    />
                  </FieldGroup>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Logout */}
        {authEnabled && (
          <Card>
            <CardContent className="pt-6">
              <form action={logoutAction}>
                <Button variant="outline" className="gap-2 w-full">
                  <LogOut className="h-4 w-4" />
                  Log out
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ===== Sticky Save Bar ===== */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 transition-all duration-300 ease-in-out ${
          dirty
            ? "translate-y-0 opacity-100"
            : "translate-y-full opacity-0 pointer-events-none"
        }`}
      >
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">You have unsaved changes</p>
          <Button
            onClick={handleSave}
            disabled={isPending}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </main>
  );
}
