"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ThreadLifetime } from "../../types/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { createAgentAction } from "../../actions";
import { AGENT_NAME_RE, AVAILABLE_SKILLS } from "../constants";

export function NewAgentClient({ availableAgents }: { availableAgents: string[] }) {
  const [isPending, startTransition] = useTransition();

  // Basic
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");

  // Configuration
  const [threadLifetime, setThreadLifetime] = useState<ThreadLifetime>("ephemeral");
  const [trigger, setTrigger] = useState("on_demand");
  const [modelProvider, setModelProvider] = useState("");
  const [model, setModel] = useState("");

  // Skills (toggle)
  const [skills, setSkills] = useState<Set<string>>(new Set());
  const toggleSkill = (s: string) => {
    setSkills((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  // Tools
  const [tools, setTools] = useState("");

  // Subagents (toggle)
  const [subagents, setSubagents] = useState<Set<string>>(new Set());
  const toggleSubagent = (s: string) => {
    setSubagents((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const nameValid = name === "" || AGENT_NAME_RE.test(name);
  const canSubmit = name.length > 0 && nameValid && description.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      try {
        await createAgentAction({
          name,
          description,
          system_prompt: systemPrompt || undefined,
          skills: Array.from(skills),
          thread_lifetime: threadLifetime,
          trigger: trigger as "on_demand" | "schedule",
          tools: tools
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          subagents: Array.from(subagents),
          model_provider: modelProvider || null,
          model: model || null,
        });
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) throw err;
        toast.error(err instanceof Error ? err.message : "Failed to create agent");
      }
    });
  };

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Link href="/agents">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">New Agent</h1>
      </div>

      <div className="grid gap-6">
        {/* Identity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identity</CardTitle>
            <CardDescription>Basic agent information</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., research-assistant"
              />
              {!nameValid && (
                <p className="text-xs text-destructive">
                  Must be lowercase letters, numbers, and underscores (start with a letter)
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this agent do?"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="system_prompt">System Prompt</Label>
              <textarea
                id="system_prompt"
                rows={4}
                className="flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Optional custom system prompt..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Execution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Execution</CardTitle>
            <CardDescription>How and when the agent runs</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="thread_lifetime">Thread Lifetime</Label>
                <Select
                  id="thread_lifetime"
                  value={threadLifetime}
                  onChange={(e) => setThreadLifetime(e.target.value as ThreadLifetime)}
                >
                  <option value="ephemeral">Ephemeral (new thread every run)</option>
                  <option value="daily">Daily (shared thread per day)</option>
                  <option value="persistent">Persistent (single shared thread)</option>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="trigger">Trigger</Label>
                <Select id="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
                  <option value="on_demand">On Demand</option>
                  <option value="schedule">Schedule (cron)</option>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Model</Label>
              <div className="flex gap-2">
                <Select
                  value={modelProvider}
                  onChange={(e) => setModelProvider(e.target.value)}
                  className="w-[180px]"
                >
                  <option value="">Default (from Settings)</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="google">Google</option>
                  <option value="groq">Groq</option>
                  <option value="ollama">Ollama</option>
                  <option value="mistral">Mistral</option>
                  <option value="bedrock">AWS Bedrock</option>
                </Select>
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={modelProvider ? "Model name" : "Default (from Settings)"}
                  className="flex-1"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Skills */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Skills</CardTitle>
            <CardDescription>
              Skills determine what the agent can do. Each skill bundles related tools and
              instructions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {AVAILABLE_SKILLS.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => toggleSkill(s.name)}
                  className={`flex items-center gap-3 p-2.5 rounded-md border text-left transition-colors ${
                    skills.has(s.name)
                      ? "border-primary bg-primary/5"
                      : "border-transparent hover:bg-muted/50"
                  }`}
                >
                  <div
                    className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                      skills.has(s.name)
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/30"
                    }`}
                  >
                    {skills.has(s.name) && (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M1.5 5L4 7.5L8.5 2.5" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{s.name}</span>
                      {s.toolCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          ({s.toolCount} {s.toolCount === 1 ? "tool" : "tools"})
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Tools & Subagents */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tools & Subagents</CardTitle>
            <CardDescription>Fine-grained tool access and agent delegation</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="tools">Additional Tools</Label>
              <Input
                id="tools"
                value={tools}
                onChange={(e) => setTools(e.target.value)}
                placeholder="Comma-separated tool names (empty = only skill-declared tools)"
              />
              <p className="text-xs text-muted-foreground">
                Tools from selected skills are automatically included
              </p>
            </div>

            {availableAgents.length > 0 && (
              <>
                <Separator />
                <div className="grid gap-2">
                  <Label>Subagents</Label>
                  <p className="text-xs text-muted-foreground">
                    Subagents can be called by this agent to delegate specialized work. Select
                    agents you want this agent to be able to invoke.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {availableAgents.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => toggleSubagent(a)}
                        className="cursor-pointer"
                      >
                        <Badge variant={subagents.has(a) ? "default" : "outline"}>{a}</Badge>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Submit */}
        <Button
          size="lg"
          onClick={handleSubmit}
          disabled={!canSubmit || isPending}
          className="w-full"
        >
          {isPending ? "Creating..." : "Create Agent"}
        </Button>
      </div>
    </main>
  );
}
