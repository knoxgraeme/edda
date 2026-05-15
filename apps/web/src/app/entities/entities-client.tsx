"use client";

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  UserRound,
  FolderGit2,
  Building2,
  Hash,
  MapPin,
  Wrench,
  Lightbulb,
  Search,
  UsersRound,
  Layers,
  MousePointer2,
  SlidersHorizontal,
  Pencil,
  Check,
  X,
  ChevronRight,
} from "lucide-react";
import type { Entity, EntityConnection, EntityType, Item } from "../types/db";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  getEntityConnectionsAction,
  getEntityItemsAction,
  updateEntityAction,
} from "../actions";

const ENTITY_TYPES: EntityType[] = [
  "person",
  "project",
  "company",
  "topic",
  "place",
  "tool",
  "concept",
];

const TYPE_ICONS: Record<EntityType, React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>> = {
  person: UserRound,
  project: FolderGit2,
  company: Building2,
  topic: Hash,
  place: MapPin,
  tool: Wrench,
  concept: Lightbulb,
};

type SortKey = "recent" | "mentions" | "az";

export function EntitiesClient({ entities: initialEntities }: { entities: Entity[] }) {
  const [entities, setEntities] = useState(initialEntities);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<EntityType | "all">("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialEntities[0]?.id ?? null,
  );

  const filtered = useMemo(() => {
    let xs = entities.slice();
    if (typeFilter !== "all") xs = xs.filter((e) => e.type === typeFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      xs = xs.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.aliases.some((a) => a.toLowerCase().includes(q)) ||
          (e.description?.toLowerCase().includes(q) ?? false),
      );
    }
    if (sort === "recent") {
      xs.sort(
        (a, b) =>
          new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime(),
      );
    }
    if (sort === "mentions") xs.sort((a, b) => b.mention_count - a.mention_count);
    if (sort === "az") xs.sort((a, b) => a.name.localeCompare(b.name));
    return xs;
  }, [entities, typeFilter, query, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: entities.length };
    for (const e of entities) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [entities]);

  const selected = useMemo(
    () => entities.find((e) => e.id === selectedId) ?? null,
    [entities, selectedId],
  );

  const handleUpdate = (updated: Entity) => {
    setEntities((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  };

  return (
    <div className="flex h-full min-h-0 w-full bg-background">
      {/* LEFT — list column */}
      <div className="flex w-[380px] flex-shrink-0 flex-col border-r border-border bg-background">
        {/* Header + search */}
        <div className="border-b border-border px-4 pt-4 pb-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UsersRound className="h-4 w-4" strokeWidth={1.75} />
              <h1 className="text-[15px] font-semibold tracking-tight">Entities</h1>
              <span className="font-mono text-xs text-muted-foreground">
                {entities.length}
              </span>
            </div>
            <button
              type="button"
              title="Filters"
              className="flex h-[26px] w-[26px] items-center justify-center rounded-[5px] border border-border bg-background text-neutral-600 hover:bg-muted"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-[13px] w-[13px] -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.75}
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search entities…"
              className="h-8 rounded-[6px] border-border bg-muted/60 pr-10 pl-8 text-[13px] shadow-none"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-[3px] border border-border bg-background px-1 py-[1px] font-mono text-[10px] text-neutral-400">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* Type rail */}
        <div className="border-b border-border p-2">
          <div className="flex flex-col gap-[1px]">
            <TypeRow
              label="All entities"
              icon={<Layers className="h-3.5 w-3.5" strokeWidth={1.75} />}
              active={typeFilter === "all"}
              count={counts.all}
              onClick={() => setTypeFilter("all")}
            />
            {ENTITY_TYPES.map((t) => {
              const Icon = TYPE_ICONS[t];
              return (
                <TypeRow
                  key={t}
                  label={t}
                  icon={<Icon className="h-3.5 w-3.5" strokeWidth={1.75} />}
                  active={typeFilter === t}
                  count={counts[t] ?? 0}
                  onClick={() => setTypeFilter(t)}
                />
              );
            })}
          </div>
        </div>

        {/* Sort bar */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
            {filtered.length} result{filtered.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-[1px]">
            {(
              [
                ["recent", "Recent"],
                ["mentions", "Mentions"],
                ["az", "A–Z"],
              ] as const
            ).map(([k, v]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSort(k)}
                className={`rounded-[4px] px-2 py-[3px] text-[11px] transition-colors ${
                  sort === k
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-muted-foreground">
              {entities.length === 0
                ? "No entities yet. They appear as Edda learns about people, projects, and topics from your conversations."
                : "No entities match."}
            </div>
          ) : (
            filtered.map((e) => (
              <EntityRow
                key={e.id}
                entity={e}
                active={e.id === selectedId}
                onClick={() => setSelectedId(e.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* RIGHT — detail */}
      {selected ? (
        <EntityDetail
          key={selected.id}
          entity={selected}
          onUpdate={handleUpdate}
          onSelectEntity={setSelectedId}
        />
      ) : (
        <EmptyDetail />
      )}
    </div>
  );
}

/* ─── Left column pieces ─────────────────────────────────────────────── */

function TypeRow({
  label,
  icon,
  active,
  count,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid grid-cols-[16px_1fr_auto] items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        active
          ? "bg-[color:var(--accent-warm-soft)] font-medium text-foreground"
          : "text-foreground hover:bg-muted/60"
      }`}
    >
      <span className={active ? "text-foreground" : "text-neutral-600"}>{icon}</span>
      <span className="capitalize">{label}</span>
      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
        {count}
      </span>
    </button>
  );
}

function EntityRow({
  entity,
  active,
  onClick,
}: {
  entity: Entity;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = TYPE_ICONS[entity.type];
  const last = formatDistanceToNowStrict(new Date(entity.last_seen_at), {
    addSuffix: true,
  });
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid w-full grid-cols-[24px_1fr_auto] items-center gap-2.5 border-b border-[color:var(--neutral-100)] px-3.5 py-2.5 text-left transition-colors ${
        active
          ? "border-l-2 border-l-[color:var(--accent-warm)] bg-[color:var(--accent-warm-soft)]"
          : "border-l-2 border-l-transparent hover:bg-muted/40"
      }`}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-[5px] border border-border bg-muted/60 text-neutral-600">
        <Icon className="h-3 w-3" strokeWidth={1.75} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{entity.name}</span>
          <span className="font-mono text-[10.5px] text-neutral-400">
            {entity.type}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
          {entity.mention_count} mention{entity.mention_count === 1 ? "" : "s"} ·{" "}
          {last}
        </span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-neutral-400" strokeWidth={1.75} />
    </button>
  );
}

/* ─── Right column — detail ──────────────────────────────────────────── */

function EmptyDetail() {
  return (
    <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
      <div className="max-w-[280px] text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <MousePointer2 className="h-[18px] w-[18px]" strokeWidth={1.5} />
        </div>
        <div className="mb-1 font-medium text-foreground">No entity selected</div>
        <div>Pick one on the left to see everything Edda knows about it.</div>
      </div>
    </div>
  );
}

function EntityDetail({
  entity,
  onUpdate,
  onSelectEntity,
}: {
  entity: Entity;
  onUpdate: (updated: Entity) => void;
  onSelectEntity: (id: string) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [related, setRelated] = useState<EntityConnection[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(entity.name);
  const [editDesc, setEditDesc] = useState(entity.description ?? "");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [its, cons] = await Promise.all([
          getEntityItemsAction(entity.id),
          getEntityConnectionsAction(entity.id),
        ]);
        if (!cancelled) {
          setItems(its);
          setRelated(cons);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setRelated([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entity.id]);

  const saveEdit = () => {
    startTransition(async () => {
      const updates: Partial<Pick<Entity, "name" | "description">> = {};
      if (editName !== entity.name) updates.name = editName;
      if (editDesc !== (entity.description ?? "")) {
        updates.description = editDesc || null;
      }
      if (Object.keys(updates).length === 0) {
        setEditing(false);
        return;
      }
      const result = await updateEntityAction(entity.id, updates);
      if (result) onUpdate(result);
      setEditing(false);
    });
  };

  const cancelEdit = () => {
    setEditName(entity.name);
    setEditDesc(entity.description ?? "");
    setEditing(false);
  };

  const Icon = TYPE_ICONS[entity.type];
  const firstSeen = entity.created_at
    ? formatDistanceToNowStrict(new Date(entity.created_at), { addSuffix: true })
    : null;
  const lastSeen = formatDistanceToNowStrict(new Date(entity.last_seen_at), {
    addSuffix: true,
  });

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border px-6 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[8px] border border-border bg-muted/60">
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="space-y-2">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Name"
                  className="h-8 text-sm"
                />
                <Input
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="Description"
                  className="h-8 text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 gap-1"
                    onClick={saveEdit}
                    disabled={isPending}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1"
                    onClick={cancelEdit}
                    disabled={isPending}
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-1 flex items-center gap-2">
                  <h2 className="text-[20px] font-semibold leading-tight tracking-tight">
                    {entity.name}
                  </h2>
                  <TypeChip type={entity.type} />
                </div>
                <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[12.5px] text-muted-foreground">
                  <span>
                    {entity.mention_count} mention
                    {entity.mention_count === 1 ? "" : "s"}
                  </span>
                  <span aria-hidden>·</span>
                  <span>last {lastSeen}</span>
                  {firstSeen && (
                    <>
                      <span aria-hidden>·</span>
                      <span>first seen {firstSeen}</span>
                    </>
                  )}
                  {entity.aliases.length > 0 && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="font-mono text-[11px]">
                        aka {entity.aliases.join(", ")}
                      </span>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          {!editing && (
            <button
              type="button"
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-muted"
              onClick={() => setEditing(true)}
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {!editing && entity.description && (
          <p className="mt-3 text-[13.5px] leading-[1.55] text-neutral-700 text-pretty">
            {entity.description}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-6 pt-4 pb-10">
        <section className="mb-6">
          <div className="section-eyebrow mb-2">Mentions · last 30 days</div>
          <MentionTimeline items={items} entity={entity} />
        </section>

        {related && related.length > 0 && (
          <section className="mb-6">
            <div className="section-eyebrow mb-2.5">
              Related · {related.length}
            </div>
            <RelatedList connections={related} onSelectEntity={onSelectEntity} />
          </section>
        )}

        <section>
          <div className="section-eyebrow mb-3">
            Linked items{items !== null ? ` · ${items.length}` : ""}
          </div>
          <LinkedItemsTable items={items} />
        </section>
      </div>
    </div>
  );
}

/* ─── Detail sub-components ──────────────────────────────────────────── */

function TypeChip({ type }: { type: EntityType }) {
  const Icon = TYPE_ICONS[type];
  return (
    <span className="inline-flex items-center gap-1 rounded-[6px] border border-border bg-muted px-[7px] py-[1px] text-[11px] font-medium text-neutral-600">
      <Icon className="h-[11px] w-[11px]" strokeWidth={1.75} />
      <span className="capitalize">{type}</span>
    </span>
  );
}

function ItemTypeChip({ type }: { type: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-[4px] bg-muted px-1.5 py-[2px] font-mono text-[10.5px] font-medium lowercase text-neutral-600">
      {type}
    </span>
  );
}

function StrengthBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(value * 100)));
  return (
    <span className="block h-[3px] w-full overflow-hidden rounded-[2px] bg-muted">
      <span
        className="block h-full bg-neutral-600"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

function RelatedList({
  connections,
  onSelectEntity,
}: {
  connections: EntityConnection[];
  onSelectEntity: (id: string) => void;
}) {
  const max = Math.max(1, ...connections.map((c) => c.shared_items));
  return (
    <div className="flex flex-col gap-[1px]">
      {connections.map((c) => {
        const Icon = TYPE_ICONS[c.type];
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectEntity(c.id)}
            className="grid w-full grid-cols-[20px_1fr_64px_72px] items-center gap-2.5 rounded-[6px] px-2 py-[7px] text-left transition-colors hover:bg-neutral-50"
          >
            <Icon
              className="h-[13px] w-[13px] text-muted-foreground"
              strokeWidth={1.75}
            />
            <span className="truncate text-[13px] font-medium">{c.name}</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {c.type}
            </span>
            <StrengthBar value={c.shared_items / max} />
          </button>
        );
      })}
    </div>
  );
}

function LinkedItemsTable({ items }: { items: Item[] | null }) {
  if (items === null) {
    return (
      <div className="rounded-[8px] border border-border p-4 text-[12.5px] text-muted-foreground">
        Loading items…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-[8px] border border-border p-4 text-[12.5px] text-muted-foreground">
        No linked items.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-[8px] border border-border">
      <div className="grid grid-cols-[100px_1fr_90px] gap-3 border-b border-border bg-muted/60 px-3 py-[7px] font-mono text-[10.5px] tracking-wider uppercase text-muted-foreground">
        <span>type</span>
        <span>content</span>
        <span className="text-right">when</span>
      </div>
      {items.map((item, i) => (
        <div
          key={item.id}
          className={`grid grid-cols-[100px_1fr_90px] items-baseline gap-3 px-3 py-2 text-[13px] ${
            i === items.length - 1 ? "" : "border-b border-[color:var(--neutral-100)]"
          }`}
        >
          <ItemTypeChip type={item.type} />
          <span className="text-neutral-900 text-pretty">
            {item.summary || item.content}
          </span>
          <span className="text-right font-mono text-[11px] tabular-nums text-neutral-400">
            {formatDistanceToNowStrict(new Date(item.created_at))}
          </span>
        </div>
      ))}
    </div>
  );
}

/* Pixel strip over the last 30 days, bucketed by day from item.created_at. */
function MentionTimeline({
  items,
  entity,
}: {
  items: Item[] | null;
  entity: Entity;
}) {
  const cells = 30;
  const buckets = useMemo(() => {
    const arr = new Array(cells).fill(0);
    if (!items) return arr;
    const day = 24 * 60 * 60 * 1000;
    // Right edge = most recent known timestamp for this entity. Deterministic
    // from props (avoids Date.now() purity rule) and still anchors the strip
    // to "this entity's latest mention".
    const lastSeen = new Date(entity.last_seen_at).getTime();
    let rightEdge = lastSeen;
    for (const it of items) {
      const t = new Date(it.created_at).getTime();
      if (t > rightEdge) rightEdge = t;
    }
    for (const it of items) {
      const t = new Date(it.created_at).getTime();
      const age = Math.floor((rightEdge - t) / day);
      if (age >= 0 && age < cells) arr[cells - 1 - age] += 1;
    }
    arr[cells - 1] = Math.max(arr[cells - 1], 1);
    return arr;
  }, [items, entity.last_seen_at]);

  const max = Math.max(1, ...buckets);

  return (
    <div className="flex h-7 items-end gap-[2px]">
      {buckets.map((v, i) => {
        const ratio = v / max;
        const bg =
          ratio > 0.75
            ? "var(--neutral-900)"
            : ratio > 0.4
              ? "var(--neutral-500)"
              : ratio > 0
                ? "var(--neutral-200)"
                : "var(--neutral-100)";
        return (
          <span
            key={i}
            className="flex-1 rounded-[1px]"
            style={{
              height: `${Math.max(8, ratio * 100)}%`,
              background: bg,
            }}
          />
        );
      })}
    </div>
  );
}
