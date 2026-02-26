"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Puzzle,
  Wrench,
  ChevronDown,
  ChevronRight,
  Bot,
  Search,
} from "lucide-react";
import type { Skill } from "../types/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

export function SkillsClient({
  skills,
  skillAgentMap,
}: {
  skills: Skill[];
  skillAgentMap: Record<string, string[]>;
}) {
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [skillFilter, setSkillFilter] = useState("");

  // Collect all unique tools across skills
  const allTools = new Set<string>();
  const skillToolsMap: Record<string, string[]> = {};
  for (const skill of skills) {
    const tools = parseAllowedTools(skill.content);
    skillToolsMap[skill.name] = tools;
    tools.forEach((t) => allTools.add(t));
  }

  const filteredSkills = useMemo(() => {
    if (!skillFilter.trim()) return skills;
    const q = skillFilter.toLowerCase();
    return skills.filter((s) => s.name.toLowerCase().includes(q));
  }, [skills, skillFilter]);

  const toggleExpand = (name: string) => {
    setExpandedSkill((prev) => (prev === name ? null : name));
  };

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Skills & Tools</h1>
          <p className="text-sm text-muted-foreground">
            {skills.length} skills, {allTools.size} tools available
          </p>
        </div>
      </div>

      <div className="grid gap-4">
        {/* Skills */}
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Puzzle className="h-4 w-4 text-muted-foreground" />
          Skills
        </h2>

        {skills.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter skills by name..."
              value={skillFilter}
              onChange={(e) => setSkillFilter(e.target.value)}
              className="pl-9"
            />
          </div>
        )}

        {skills.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Puzzle className="h-8 w-8 mb-2" />
              <p className="text-sm">No skills found. Run the server to seed skills.</p>
            </CardContent>
          </Card>
        ) : filteredSkills.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <p className="text-sm">No skills match &quot;{skillFilter}&quot;</p>
            </CardContent>
          </Card>
        ) : (
          filteredSkills.map((skill) => {
            const tools = skillToolsMap[skill.name] ?? [];
            const agents = skillAgentMap[skill.name] ?? [];
            const isExpanded = expandedSkill === skill.name;
            const body = parseBody(skill.content);

            return (
              <Card key={skill.name}>
                <CardHeader className="pb-2">
                  <button
                    className="flex items-start gap-2 text-left w-full"
                    onClick={() => toggleExpand(skill.name)}
                  >
                    <div className="mt-0.5">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">{skill.name}</CardTitle>
                        {skill.is_system && (
                          <Badge variant="outline" className="text-xs">
                            system
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-xs">
                          v{skill.version}
                        </Badge>
                        {tools.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {tools.length} {tools.length === 1 ? "tool" : "tools"}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                        {String(skill.description ?? "")}
                      </p>
                    </div>
                  </button>
                </CardHeader>
                {isExpanded && (
                  <CardContent className="pt-0">
                    {/* Full description if truncated */}
                    {skill.description && String(skill.description).length > 80 && (
                      <p className="text-sm text-muted-foreground mb-2">
                        {String(skill.description)}
                      </p>
                    )}

                    {/* Tools */}
                    {tools.length > 0 && (
                      <div className="mb-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Tools ({tools.length})
                        </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {tools.map((t) => (
                            <Badge key={t} variant="outline" className="text-xs font-mono">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Agents using this skill */}
                    {agents.length > 0 && (
                      <div>
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Used by
                        </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {agents.map((a) => (
                            <Link key={a} href={`/agents/${a}`}>
                              <Badge variant="secondary" className="text-xs gap-1 cursor-pointer hover:bg-secondary/80">
                                <Bot className="h-3 w-3" />
                                {a}
                              </Badge>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Expanded content */}
                    {body && (
                      <div className="mt-3 pt-3 border-t">
                        <pre className="text-xs bg-muted rounded-md p-3 whitespace-pre-wrap overflow-auto max-h-64">
                          {body}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })
        )}

        {/* All Tools Reference */}
        <h2 className="text-lg font-semibold flex items-center gap-2 mt-4">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          All Tools
        </h2>

        <Card>
          <CardContent className="pt-6">
            {allTools.size === 0 ? (
              <p className="text-sm text-muted-foreground">No tools found.</p>
            ) : (
              <div className="grid gap-2">
                {Array.from(allTools)
                  .sort()
                  .map((tool) => {
                    // Find which skills use this tool
                    const usedBy = skills
                      .filter((s) => skillToolsMap[s.name]?.includes(tool))
                      .map((s) => s.name);
                    return (
                      <div
                        key={tool}
                        className="flex items-center justify-between py-1.5 border-b last:border-0"
                      >
                        <code className="text-sm font-mono">{tool}</code>
                        <div className="flex gap-1">
                          {usedBy.map((s) => (
                            <Badge key={s} variant="outline" className="text-xs">
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
