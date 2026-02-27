"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Puzzle,
  Wrench,
  Bot,
  Search,
  ChevronDown,
  Layers,
  ArrowRight,
} from "lucide-react";
import type { Skill } from "../types/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/** Parse allowed-tools from SKILL.md YAML frontmatter */
function parseAllowedTools(content: string): string[] {
  const parts = content.split("---");
  if (parts.length < 3) return [];
  const yaml = parts[1];
  const match = yaml.match(/allowed-tools:\s*\n((?:\s+-\s+.+\n?)*)/);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

/** Extract the markdown body (after frontmatter) */
function parseBody(content: string): string {
  const parts = content.split("---");
  if (parts.length < 3) return content;
  return parts.slice(2).join("---").trim();
}

/** Extract the first meaningful paragraph from the body */
function extractSummary(body: string): string {
  const lines = body.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  return lines.slice(0, 2).join(" ").slice(0, 200);
}

function SkillCard({
  skill,
  tools,
  agents,
  isExpanded,
  onToggle,
}: {
  skill: Skill;
  tools: string[];
  agents: string[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const body = parseBody(skill.content);
  const summary = extractSummary(body);

  return (
    <Card
      className={`transition-all duration-200 ${isExpanded ? "ring-1 ring-accent-warm/30" : "hover:border-muted-foreground/20"}`}
    >
      <button className="w-full text-left p-5" onClick={onToggle}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Header row */}
            <div className="flex items-center gap-2.5 mb-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                <Puzzle className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <span className="font-medium text-sm">{skill.name}</span>
              {skill.is_system && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                  system
                </Badge>
              )}
            </div>

            {/* Description */}
            <p className="text-sm text-muted-foreground ml-[38px] line-clamp-2">
              {String(skill.description ?? summary)}
            </p>
          </div>

          {/* Right-side metadata */}
          <div className="flex items-center gap-3 shrink-0 pt-0.5">
            {tools.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Wrench className="h-3 w-3" />
                <span>{tools.length}</span>
              </div>
            )}
            {agents.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Bot className="h-3 w-3" />
                <span>{agents.length}</span>
              </div>
            )}
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
            />
          </div>
        </div>
      </button>

      {/* Expanded detail panel */}
      {isExpanded && (
        <CardContent className="pt-0 pb-5 px-5">
          <div className="border-t pt-4 space-y-4 ml-[38px]">
            {/* Tools section */}
            {tools.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Wrench className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Tools
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tools.map((t) => (
                    <code
                      key={t}
                      className="text-xs font-mono bg-muted px-2 py-0.5 rounded-md text-foreground/80"
                    >
                      {t}
                    </code>
                  ))}
                </div>
              </div>
            )}

            {/* Agents section */}
            {agents.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Bot className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Used by
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {agents.map((a) => (
                    <Link key={a} href={`/agents/${a}`} onClick={(e) => e.stopPropagation()}>
                      <Badge
                        variant="secondary"
                        className="text-xs gap-1 cursor-pointer hover:bg-secondary/80 font-normal"
                      >
                        <Bot className="h-3 w-3" />
                        {a}
                        <ArrowRight className="h-2.5 w-2.5 ml-0.5 opacity-50" />
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Skill content preview */}
            {body && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Layers className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Skill definition
                  </span>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 max-h-48 overflow-auto">
                  <pre className="text-xs font-mono whitespace-pre-wrap text-foreground/70 leading-relaxed">
                    {body}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function ToolRow({
  tool,
  skills,
}: {
  tool: string;
  skills: string[];
}) {
  return (
    <div className="flex items-center justify-between py-2.5 group">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-muted shrink-0">
          <Wrench className="h-3 w-3 text-muted-foreground" />
        </div>
        <code className="text-sm font-mono truncate">{tool}</code>
      </div>
      <div className="flex gap-1.5 shrink-0">
        {skills.map((s) => (
          <Badge key={s} variant="outline" className="text-[10px] font-normal px-1.5 py-0">
            {s}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function SkillsClient({
  skills,
  skillAgentMap,
}: {
  skills: Skill[];
  skillAgentMap: Record<string, string[]>;
}) {
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // Build tool maps
  const skillToolsMap: Record<string, string[]> = {};
  const toolSkillMap: Record<string, string[]> = {};
  for (const skill of skills) {
    const tools = parseAllowedTools(skill.content);
    skillToolsMap[skill.name] = tools;
    for (const t of tools) {
      if (!toolSkillMap[t]) toolSkillMap[t] = [];
      toolSkillMap[t].push(skill.name);
    }
  }

  const allToolsSorted = useMemo(() => Object.keys(toolSkillMap).sort(), [toolSkillMap]);

  const filteredSkills = useMemo(() => {
    if (!filter.trim()) return skills;
    const q = filter.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        String(s.description ?? "")
          .toLowerCase()
          .includes(q),
    );
  }, [skills, filter]);

  const filteredTools = useMemo(() => {
    if (!filter.trim()) return allToolsSorted;
    const q = filter.toLowerCase();
    return allToolsSorted.filter(
      (t) => t.toLowerCase().includes(q) || toolSkillMap[t]?.some((s) => s.toLowerCase().includes(q)),
    );
  }, [allToolsSorted, filter, toolSkillMap]);

  const toggleExpand = (name: string) => {
    setExpandedSkill((prev) => (prev === name ? null : name));
  };

  return (
    <main className="max-w-4xl mx-auto p-6">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Skills & Tools</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {skills.length} skills and {allToolsSorted.length} tools powering your agents
        </p>
      </div>

      <Tabs defaultValue="skills">
        {/* Tab bar + search in a unified row */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <TabsList>
            <TabsTrigger value="skills" className="gap-1.5">
              <Puzzle className="h-3.5 w-3.5" />
              Skills
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 font-normal">
                {skills.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="tools" className="gap-1.5">
              <Wrench className="h-3.5 w-3.5" />
              Tools
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 font-normal">
                {allToolsSorted.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
        </div>

        {/* Skills tab */}
        <TabsContent value="skills">
          {skills.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Puzzle className="h-8 w-8 mb-3 opacity-40" />
                <p className="text-sm font-medium">No skills found</p>
                <p className="text-xs mt-1">Run the server to seed default skills.</p>
              </CardContent>
            </Card>
          ) : filteredSkills.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Search className="h-6 w-6 mb-2 opacity-40" />
                <p className="text-sm">
                  No skills match &quot;{filter}&quot;
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredSkills.map((skill) => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  tools={skillToolsMap[skill.name] ?? []}
                  agents={skillAgentMap[skill.name] ?? []}
                  isExpanded={expandedSkill === skill.name}
                  onToggle={() => toggleExpand(skill.name)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tools tab */}
        <TabsContent value="tools">
          {allToolsSorted.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Wrench className="h-8 w-8 mb-3 opacity-40" />
                <p className="text-sm font-medium">No tools found</p>
                <p className="text-xs mt-1">Tools are declared by skills.</p>
              </CardContent>
            </Card>
          ) : filteredTools.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Search className="h-6 w-6 mb-2 opacity-40" />
                <p className="text-sm">
                  No tools match &quot;{filter}&quot;
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-2 pb-2 divide-y divide-border">
                {filteredTools.map((tool) => (
                  <ToolRow key={tool} tool={tool} skills={toolSkillMap[tool] ?? []} />
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
