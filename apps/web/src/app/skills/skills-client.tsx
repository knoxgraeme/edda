"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Puzzle,
  Wrench,
  Bot,
  Search,
  ArrowRight,
  FileText,
  FileCode,
  Folder,
  ChevronDown,
} from "lucide-react";
import type { Skill } from "../types/db";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Parse allowed-tools from SKILL.md YAML frontmatter. */
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

/** Minimal markdown renderer for SKILL.md previews. */
function MdPreview({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let listBuf: string[] | null = null;
  let inCode = false;

  const flushList = () => {
    if (listBuf) {
      const buf = listBuf;
      out.push(
        <ul
          key={`ul-${out.length}`}
          className="ml-5 mb-2.5 list-disc text-[13px] leading-[1.65] text-foreground"
        >
          {buf.map((li, i) => (
            <li key={i} className="mb-0.5">
              {inline(li)}
            </li>
          ))}
        </ul>,
      );
      listBuf = null;
    }
  };

  function inline(s: string): React.ReactNode {
    const parts: React.ReactNode[] = [];
    let i = 0;
    let key = 0;
    const matches = Array.from(
      s.matchAll(/(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g),
    );
    for (const m of matches) {
      const idx = m.index ?? 0;
      if (idx > i) parts.push(s.slice(i, idx));
      if (m[2])
        parts.push(
          <strong key={key++} className="font-semibold">
            {m[2]}
          </strong>,
        );
      else if (m[3])
        parts.push(
          <code
            key={key++}
            className="rounded-sm bg-muted px-1.5 py-[1px] font-mono text-[12px]"
          >
            {m[3]}
          </code>,
        );
      else if (m[4])
        parts.push(
          <a
            key={key++}
            href={m[5]}
            className="text-[color:var(--accent-warm)] underline"
          >
            {m[4]}
          </a>,
        );
      i = idx + m[0].length;
    }
    if (i < s.length) parts.push(s.slice(i));
    return parts;
  }

  lines.forEach((l, idx) => {
    if (l.startsWith("```")) {
      flushList();
      inCode = !inCode;
      return;
    }
    if (inCode) {
      out.push(
        <div
          key={idx}
          className="bg-muted/40 px-2.5 font-mono text-[12px] text-foreground"
        >
          {l || "\u00A0"}
        </div>,
      );
      return;
    }
    if (l.startsWith("# ")) {
      flushList();
      out.push(
        <h1 key={idx} className="mt-1 mb-2 text-[17px] font-semibold">
          {inline(l.slice(2))}
        </h1>,
      );
      return;
    }
    if (l.startsWith("## ")) {
      flushList();
      out.push(
        <h2 key={idx} className="mt-3.5 mb-1.5 text-[14px] font-semibold">
          {inline(l.slice(3))}
        </h2>,
      );
      return;
    }
    if (l.startsWith("### ")) {
      flushList();
      out.push(
        <h3
          key={idx}
          className="mt-3 mb-1 text-[13px] font-semibold text-neutral-600 dark:text-neutral-300"
        >
          {inline(l.slice(4))}
        </h3>,
      );
      return;
    }
    if (/^\s*-\s+/.test(l)) {
      (listBuf ||= []).push(l.replace(/^\s*-\s+/, ""));
      return;
    }
    flushList();
    if (!l.trim()) {
      out.push(<div key={idx} className="h-2" />);
      return;
    }
    out.push(
      <p
        key={idx}
        className="mb-2 text-[13px] leading-[1.65] text-foreground"
      >
        {inline(l)}
      </p>,
    );
  });
  flushList();
  return <div>{out}</div>;
}

function FilePreview({ path, text }: { path: string; text: string }) {
  const isMd = path.endsWith(".md");
  const lineCount = text.split("\n").length;
  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5">
        <div className="flex items-center gap-1.5 font-mono text-[12px] text-neutral-600 dark:text-neutral-300">
          {isMd ? (
            <FileText className="h-3 w-3 text-muted-foreground" />
          ) : (
            <FileCode className="h-3 w-3 text-muted-foreground" />
          )}
          {path}
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          {lineCount} lines
        </span>
      </div>
      <div className={isMd ? "p-4" : "p-0"}>
        {isMd ? (
          <MdPreview text={text} />
        ) : (
          <pre className="m-0 overflow-x-auto bg-muted/40 p-3.5 font-mono text-[12.5px] leading-[1.65] text-foreground">
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}

function FileTree({
  files,
  skillName,
  active,
  onPick,
}: {
  files: { path: string; primary?: boolean }[];
  skillName: string;
  active: string;
  onPick: (path: string) => void;
}) {
  if (files.length <= 1) return null;
  const byDir: Record<string, { path: string; primary?: boolean }[]> = {};
  for (const f of files) {
    const parts = f.path.split("/");
    const dir = parts.length > 1 ? parts[0] : "";
    (byDir[dir] ||= []).push(f);
  }
  return (
    <div className="overflow-hidden rounded-md border border-border bg-background font-mono text-[12.5px]">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-1.5">
        <Folder className="h-3 w-3 text-muted-foreground" />
        <span className="text-[11.5px] text-neutral-600 dark:text-neutral-300">
          {skillName}/
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {files.length} files
        </span>
      </div>
      <div className="py-1">
        {Object.entries(byDir).map(([dir, dirFiles]) => (
          <div key={dir || "_root"}>
            {dir && (
              <div className="flex items-center gap-1 px-3 pt-1 pb-0.5 pl-5 text-[11.5px] text-neutral-600 dark:text-neutral-300">
                <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
                <Folder className="h-2.5 w-2.5 text-muted-foreground" />
                {dir}/
              </div>
            )}
            {dirFiles.map((f) => {
              const name = f.path.split("/").pop() ?? f.path;
              const on = active === f.path;
              return (
                <button
                  key={f.path}
                  onClick={() => onPick(f.path)}
                  className={cn(
                    "flex w-full items-center gap-1.5 border-l-2 text-left text-[12.5px]",
                    on
                      ? "border-foreground bg-muted text-foreground"
                      : "border-transparent text-neutral-600 dark:text-neutral-300 hover:bg-muted/50",
                    dir ? "py-1 pr-3 pl-10" : "py-1 pr-3 pl-6",
                  )}
                >
                  {f.path.endsWith(".md") ? (
                    <FileText className="h-2.5 w-2.5 text-muted-foreground" />
                  ) : (
                    <FileCode className="h-2.5 w-2.5 text-muted-foreground" />
                  )}
                  <span className={f.primary ? "font-semibold" : ""}>
                    {name}
                  </span>
                  {f.primary && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      primary
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillBody({ skill }: { skill: Skill }) {
  const files = useMemo(
    () => [
      { path: "SKILL.md", primary: true },
      ...Object.keys(skill.files ?? {}).map((p) => ({ path: p })),
    ],
    [skill],
  );
  const [active, setActive] = useState("SKILL.md");
  const [lastKey, setLastKey] = useState(skill.name);
  if (lastKey !== skill.name) {
    setLastKey(skill.name);
    setActive("SKILL.md");
  }
  const getContent = (path: string) => {
    if (path === "SKILL.md") return parseBody(skill.content);
    return skill.files?.[path] ?? "";
  };
  const multi = files.length > 1;
  return (
    <div className={cn("grid gap-3.5", multi ? "grid-cols-[220px_1fr]" : "")}>
      {multi && (
        <FileTree
          files={files}
          skillName={skill.name}
          active={active}
          onPick={setActive}
        />
      )}
      <FilePreview path={active} text={getContent(active)} />
    </div>
  );
}

function SkillRow({
  skill,
  tools,
  agents,
  fileCount,
  active,
  onClick,
}: {
  skill: Skill;
  tools: string[];
  agents: string[];
  fileCount: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2.5 border-l-2 border-b border-neutral-100 px-4 py-3 text-left dark:border-neutral-900",
        active
          ? "border-l-foreground bg-muted"
          : "border-l-transparent hover:bg-muted/50",
      )}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] bg-muted">
        <Puzzle className="h-3 w-3 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-1.5">
          <span className="font-mono text-[13px] font-medium">
            {skill.name}
          </span>
          {skill.is_system && (
            <span className="rounded-sm border border-border px-1 py-[1px] font-mono text-[10px] text-muted-foreground">
              system
            </span>
          )}
        </div>
        <div className="line-clamp-2 text-[12.5px] leading-[1.45] text-muted-foreground">
          {skill.description}
        </div>
        <div className="mt-1.5 flex gap-3 font-mono text-[11px] text-neutral-400">
          <span className="inline-flex items-center gap-0.5">
            <Wrench className="h-2.5 w-2.5" />
            {tools.length}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <Bot className="h-2.5 w-2.5" />
            {agents.length}
          </span>
          {fileCount > 1 && (
            <span className="inline-flex items-center gap-0.5">
              <FileText className="h-2.5 w-2.5" />
              {fileCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function SDLRow({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="border-t border-neutral-100 py-3 text-[13px] text-muted-foreground dark:border-neutral-900">
        {term}
      </dt>
      <dd className="m-0 border-t border-neutral-100 py-3 text-[13px] text-foreground dark:border-neutral-900">
        {children}
      </dd>
    </>
  );
}

export function SkillsClient({
  skills,
  skillAgentMap,
}: {
  skills: Skill[];
  skillAgentMap: Record<string, string[]>;
}) {
  const [selected, setSelected] = useState<string | null>(
    skills[0]?.name ?? null,
  );
  const [query, setQuery] = useState("");

  const skillToolsMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const s of skills) map[s.name] = parseAllowedTools(s.content);
    return map;
  }, [skills]);

  const filteredSkills = useMemo(() => {
    if (!query.trim()) return skills;
    const q = query.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        String(s.description ?? "")
          .toLowerCase()
          .includes(q),
    );
  }, [skills, query]);

  const currentSkill = skills.find((s) => s.name === selected) ?? skills[0];
  const tools = currentSkill ? (skillToolsMap[currentSkill.name] ?? []) : [];
  const agents = currentSkill ? (skillAgentMap[currentSkill.name] ?? []) : [];
  const fileCount = currentSkill
    ? 1 + Object.keys(currentSkill.files ?? {}).length
    : 0;

  if (skills.length === 0) {
    return (
      <main className="flex h-full flex-col items-center justify-center p-10 text-muted-foreground">
        <Puzzle className="mb-3 h-8 w-8 opacity-40" />
        <p className="text-sm font-medium">No skills found</p>
        <p className="mt-1 text-xs">Run the server to seed default skills.</p>
      </main>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Page header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-2.5">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-mono text-[17px] font-semibold">skills</h1>
          <span className="font-mono text-[12px] text-muted-foreground">
            {skills.length} skills
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left rail */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-border">
          <div className="border-b border-border p-2.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-muted-foreground"
                aria-hidden
              />
              <Input
                placeholder="Filter skills…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 pl-8 text-[13px]"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredSkills.length === 0 ? (
              <div className="p-10 text-center text-[12.5px] text-muted-foreground">
                No skills match &quot;{query}&quot;
              </div>
            ) : (
              filteredSkills.map((s) => (
                <SkillRow
                  key={s.name}
                  skill={s}
                  tools={skillToolsMap[s.name] ?? []}
                  agents={skillAgentMap[s.name] ?? []}
                  fileCount={1 + Object.keys(s.files ?? {}).length}
                  active={currentSkill?.name === s.name}
                  onClick={() => setSelected(s.name)}
                />
              ))
            )}
          </div>
        </aside>

        {/* Detail pane */}
        {currentSkill && (
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-6 py-3">
              <div className="flex min-w-0 items-baseline gap-2.5">
                <h2 className="font-mono text-[15px] font-semibold">
                  {currentSkill.name}
                </h2>
                <span className="font-mono text-[12px] text-muted-foreground">
                  {currentSkill.is_system ? "system" : "user"} · {tools.length}{" "}
                  tool{tools.length === 1 ? "" : "s"} · {fileCount} file
                  {fileCount === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <dl className="m-0 grid grid-cols-[140px_1fr] gap-x-4 px-6 py-4">
                <SDLRow term="Name">
                  <span className="font-mono">{currentSkill.name}</span>
                </SDLRow>

                <SDLRow term="Source">
                  <span className="inline-flex items-center rounded-sm border border-border bg-background px-1.5 py-[1px] font-mono text-[11.5px] text-neutral-600 dark:text-neutral-300">
                    {currentSkill.is_system ? "system" : "user"}
                  </span>
                  <span className="ml-2 font-mono text-[12px] text-muted-foreground italic">
                    {currentSkill.is_system
                      ? "edits require admin"
                      : "freely editable"}
                  </span>
                </SDLRow>

                <SDLRow term="Description">{currentSkill.description}</SDLRow>

                <SDLRow term="Allowed tools">
                  {tools.length === 0 ? (
                    <span className="text-[12.5px] text-muted-foreground italic">
                      No tools declared in frontmatter.
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {tools.map((t) => (
                        <code
                          key={t}
                          className="rounded-sm bg-foreground px-1.5 py-[3px] font-mono text-[11.5px] text-background"
                        >
                          {t}
                        </code>
                      ))}
                    </div>
                  )}
                </SDLRow>

                <SDLRow term="Used by">
                  {agents.length === 0 ? (
                    <span className="text-[12.5px] text-muted-foreground italic">
                      Not yet attached to any agent.
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {agents.map((a) => (
                        <Link
                          key={a}
                          href={`/agents/${a}`}
                          className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-background px-2 py-[3px] font-mono text-[12px] font-medium text-foreground no-underline hover:bg-muted"
                        >
                          <Bot className="h-2.5 w-2.5 text-muted-foreground" />
                          {a}
                          <ArrowRight className="h-2.5 w-2.5 text-neutral-400" />
                        </Link>
                      ))}
                    </div>
                  )}
                </SDLRow>

                <SDLRow term="Definition">
                  <SkillBody skill={currentSkill} />
                </SDLRow>
              </dl>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
