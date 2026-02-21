"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  User,
  Briefcase,
  Building2,
  Hash,
  MapPin,
  Wrench,
  Lightbulb,
  Search,
  ChevronDown,
  ChevronRight,
  Pencil,
  Check,
  X,
  Users,
} from "lucide-react";
import type { Entity, EntityType, Item } from "../types/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateEntityAction, getEntityItemsAction } from "../actions";

const ENTITY_TYPES: EntityType[] = [
  "person",
  "project",
  "company",
  "topic",
  "place",
  "tool",
  "concept",
];

const TYPE_ICONS: Record<EntityType, React.ComponentType<{ className?: string }>> = {
  person: User,
  project: Briefcase,
  company: Building2,
  topic: Hash,
  place: MapPin,
  tool: Wrench,
  concept: Lightbulb,
};

function EntityDetail({
  entity,
  onUpdate,
}: {
  entity: Entity;
  onUpdate: (updated: Entity) => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(entity.name);
  const [editDesc, setEditDesc] = useState(entity.description ?? "");
  const [isPending, startTransition] = useTransition();

  const loadItems = async () => {
    if (items !== null) return;
    setLoadingItems(true);
    try {
      const result = await getEntityItemsAction(entity.id);
      setItems(result);
    } catch {
      setItems([]);
    } finally {
      setLoadingItems(false);
    }
  };

  const saveEdit = () => {
    startTransition(async () => {
      const updates: Partial<Pick<Entity, "name" | "description">> = {};
      if (editName !== entity.name) updates.name = editName;
      if (editDesc !== (entity.description ?? "")) updates.description = editDesc || null;
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

  // Load items on mount
  if (items === null && !loadingItems) {
    loadItems();
  }

  return (
    <div className="px-4 pb-4 space-y-3">
      {entity.aliases.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Aliases:</span>
          {entity.aliases.map((alias) => (
            <Badge key={alias} variant="outline" className="text-xs">
              {alias}
            </Badge>
          ))}
        </div>
      )}

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
            <Button size="sm" className="h-7 gap-1" onClick={saveEdit} disabled={isPending}>
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
        <div className="flex items-start justify-between">
          {entity.description && (
            <p className="text-sm text-muted-foreground">{entity.description}</p>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">
          Linked Items {items !== null && `(${items.length})`}
        </p>
        {loadingItems && <p className="text-xs text-muted-foreground">Loading...</p>}
        {items !== null && items.length === 0 && (
          <p className="text-xs text-muted-foreground">No linked items.</p>
        )}
        {items?.map((item) => (
          <div key={item.id} className="flex items-start gap-2 py-1.5 border-b last:border-0">
            <Badge variant="secondary" className="text-xs shrink-0">
              {item.type}
            </Badge>
            <p className="text-sm leading-snug flex-1 min-w-0">
              {item.summary || item.content}
            </p>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EntitiesClient({ entities: initialEntities }: { entities: Entity[] }) {
  const [entities, setEntities] = useState(initialEntities);
  const [filter, setFilter] = useState<EntityType | null>(null);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = entities.filter((e) => {
    if (filter && e.type !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.name.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q)) ||
        (e.description?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  const typeCounts = ENTITY_TYPES.reduce(
    (acc, t) => {
      acc[t] = entities.filter((e) => e.type === t).length;
      return acc;
    },
    {} as Record<EntityType, number>,
  );

  const handleUpdate = (updated: Entity) => {
    setEntities((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  };

  return (
    <main className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <Users className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Entities</h1>
        <Badge variant="secondary" className="ml-auto">
          {filtered.length}
        </Badge>
      </div>

      <div className="flex flex-col gap-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search entities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            variant={filter === null ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(null)}
          >
            All ({entities.length})
          </Button>
          {ENTITY_TYPES.map((type) => {
            const Icon = TYPE_ICONS[type];
            const count = typeCounts[type];
            if (count === 0) return null;
            return (
              <Button
                key={type}
                variant={filter === type ? "default" : "outline"}
                size="sm"
                className="gap-1.5"
                onClick={() => setFilter(filter === type ? null : type)}
              >
                <Icon className="h-3.5 w-3.5" />
                {type} ({count})
              </Button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Users className="h-12 w-12 mb-4" />
          <p className="text-lg font-medium">
            {entities.length === 0 ? "No entities yet" : "No matching entities"}
          </p>
          <p className="text-sm">
            {entities.length === 0
              ? "Entities will appear here as the agent discovers them."
              : "Try adjusting your search or filter."}
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((entity) => {
            const Icon = TYPE_ICONS[entity.type];
            const isExpanded = expandedId === entity.id;

            return (
              <Card key={entity.id}>
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setExpandedId(isExpanded ? null : entity.id)}
                >
                  <CardContent className="flex items-center gap-3 py-3">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{entity.name}</span>
                        <Badge variant="secondary" className="text-xs">
                          {entity.type}
                        </Badge>
                      </div>
                      {entity.description && !isExpanded && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {entity.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {entity.mention_count} mention{entity.mention_count !== 1 ? "s" : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(entity.last_seen_at), { addSuffix: true })}
                      </span>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </CardContent>
                </button>
                {isExpanded && <EntityDetail entity={entity} onUpdate={handleUpdate} />}
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
