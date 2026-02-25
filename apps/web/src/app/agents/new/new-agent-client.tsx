"use client";

import { useState, useTransition } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { createAgentAction } from "../../actions";

const AGENT_NAME_RE = /^[a-z][a-z0-9_]*$/;

export function NewAgentClient() {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [skills, setSkills] = useState("");
  const [schedule, setSchedule] = useState("");
  const [contextMode, setContextMode] = useState("isolated");
  const [trigger, setTrigger] = useState("on_demand");
  const [tools, setTools] = useState("");

  const nameValid = name === "" || AGENT_NAME_RE.test(name);
  const canSubmit = name.length > 0 && nameValid && description.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      // createAgentAction calls redirect() on success which throws NEXT_REDIRECT.
      // Don't wrap in try/catch — let Next.js handle the redirect.
      await createAgentAction({
        name,
        description,
        system_prompt: systemPrompt || undefined,
        skills: skills
          ? skills
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        schedule: schedule || undefined,
        context_mode: contextMode as "isolated" | "daily" | "persistent",
        trigger: trigger as "on_demand" | "schedule" | "post_conversation",
        tools: tools
          ? tools
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
      });
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent Configuration</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my_agent"
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
              className="flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Optional custom system prompt..."
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="skills">Skills</Label>
            <Input
              id="skills"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="capture, recall, daily_digest (comma-separated)"
            />
            <p className="text-xs text-muted-foreground">
              Available: capture, context_refresh, daily_digest, manage, memory_catchup,
              post_process, recall, type_evolution, weekly_reflect
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="context_mode">Context Mode</Label>
              <Select
                id="context_mode"
                value={contextMode}
                onChange={(e) => setContextMode(e.target.value)}
              >
                <option value="isolated">Isolated</option>
                <option value="daily">Daily</option>
                <option value="persistent">Persistent</option>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="trigger">Trigger</Label>
              <Select id="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
                <option value="on_demand">On Demand</option>
                <option value="schedule">Schedule</option>
                <option value="post_conversation">Post Conversation</option>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="schedule">Schedule</Label>
            <Input
              id="schedule"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="0 7 * * * (cron expression, optional)"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tools">Tools</Label>
            <Input
              id="tools"
              value={tools}
              onChange={(e) => setTools(e.target.value)}
              placeholder="Comma-separated tool names (empty = all tools)"
            />
          </div>

          <Button onClick={handleSubmit} disabled={!canSubmit || isPending} className="mt-2">
            {isPending ? "Creating..." : "Create Agent"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
