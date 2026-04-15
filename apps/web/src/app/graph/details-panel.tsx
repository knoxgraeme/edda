"use client";

import type { ReactNode } from "react";
import { RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  type EntityWithItems,
  type GraphNode,
  type Item,
  type NodeDetail,
  colorFor,
  formatDateTime,
} from "./graph-types";

interface DetailsPanelProps {
  selected: GraphNode;
  detail: NodeDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  selectedNeighbors: Array<{ node: GraphNode; relationship?: string }> | null;
  nodesById: Map<string, GraphNode>;
  onSelect: (node: GraphNode) => void;
  onClose: () => void;
}

export function DetailsPanel({
  selected,
  detail,
  detailLoading,
  detailError,
  selectedNeighbors,
  nodesById,
  onSelect,
  onClose,
}: DetailsPanelProps) {
  return (
    <div className="absolute right-4 top-16 bottom-4 z-10 flex w-96 flex-col rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <Badge variant="secondary" className="mb-1.5 text-[10px]">
            <span
              className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
              style={{ backgroundColor: colorFor(selected) }}
            />
            {selected.kind} · {selected.group}
          </Badge>
          <p className="text-sm font-semibold leading-snug">{selected.label}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {selected.kind === "entity"
              ? `Observed ${selected.weight} time${selected.weight !== 1 ? "s" : ""}`
              : `Linked to ${selected.weight} entit${selected.weight !== 1 ? "ies" : "y"}`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {detailLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Loading details...
          </div>
        )}
        {detailError && (
          <p className="text-xs text-destructive">Failed to load details: {detailError}</p>
        )}

        {detail?.kind === "entity" && (
          <EntityDetailBody
            data={detail.data}
            nodesById={nodesById}
            onSelect={onSelect}
          />
        )}

        {detail?.kind === "item" && (
          <ItemDetailBody
            data={detail.data}
            selectedNeighbors={selectedNeighbors}
            onSelect={onSelect}
          />
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Entity variant
// ──────────────────────────────────────────────

function EntityDetailBody({
  data,
  nodesById,
  onSelect,
}: {
  data: EntityWithItems;
  nodesById: Map<string, GraphNode>;
  onSelect: (node: GraphNode) => void;
}) {
  return (
    <div className="space-y-3">
      {data.description && (
        <p className="text-xs leading-relaxed text-muted-foreground">{data.description}</p>
      )}

      {data.aliases.length > 0 && (
        <DetailSection label="Aliases">
          <div className="flex flex-wrap gap-1.5">
            {data.aliases.map((a) => (
              <Badge key={a} variant="outline" className="text-[10px]">
                {a}
              </Badge>
            ))}
          </div>
        </DetailSection>
      )}

      <DetailSection label="Activity">
        <KeyValueRow k="First seen" v={formatDateTime(data.created_at)} />
        <KeyValueRow k="Last seen" v={formatDateTime(data.last_seen_at)} />
        <KeyValueRow k="Times observed" v={String(data.mention_count)} />
        <KeyValueRow k="Items extracted" v={String(data.items?.length ?? 0)} />
      </DetailSection>

      {Object.keys(data.metadata ?? {}).length > 0 && (
        <DetailSection label="Metadata">
          <MetadataDetails metadata={data.metadata} />
        </DetailSection>
      )}

      <DetailSection label={`Linked items (${data.items?.length ?? 0})`}>
        {!data.items || data.items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No linked items.</p>
        ) : (
          <ul className="space-y-1">
            {data.items.map((it) => {
              const graphNode = nodesById.get(it.id);
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    disabled={!graphNode}
                    onClick={() => graphNode && onSelect(graphNode)}
                    className={cn(
                      "group flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left",
                      graphNode
                        ? "hover:border-border hover:bg-muted/50"
                        : "cursor-default opacity-70",
                    )}
                  >
                    <span
                      className="mt-1 h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: colorFor({ kind: "item", group: it.type }),
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {it.summary || it.content}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {it.type} · {it.status}
                        {!graphNode && " · not in current graph view"}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DetailSection>
    </div>
  );
}

// ──────────────────────────────────────────────
// Item variant
// ──────────────────────────────────────────────

function ItemDetailBody({
  data,
  selectedNeighbors,
  onSelect,
}: {
  data: Item;
  selectedNeighbors: Array<{ node: GraphNode; relationship?: string }> | null;
  onSelect: (node: GraphNode) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="max-h-48 overflow-y-auto rounded-md border border-border/50 bg-muted/20 p-2">
        <p className="whitespace-pre-wrap text-xs leading-relaxed">{data.content}</p>
      </div>

      <DetailSection label="Properties">
        <KeyValueRow k="Type" v={data.type} />
        <KeyValueRow k="Status" v={data.status} />
        <KeyValueRow k="Source" v={data.source} />
        <KeyValueRow k="Day" v={data.day} />
        <KeyValueRow k="Created" v={formatDateTime(data.created_at)} />
        <KeyValueRow k="Updated" v={formatDateTime(data.updated_at)} />
        <KeyValueRow k="Reinforced" v={formatDateTime(data.last_reinforced_at)} />
        {data.completed_at && (
          <KeyValueRow k="Completed" v={formatDateTime(data.completed_at)} />
        )}
      </DetailSection>

      {Object.keys(data.metadata ?? {}).length > 0 && (
        <DetailSection label="Metadata">
          <MetadataDetails metadata={data.metadata} />
        </DetailSection>
      )}

      <DetailSection label={`Linked entities (${selectedNeighbors?.length ?? 0})`}>
        {!selectedNeighbors || selectedNeighbors.length === 0 ? (
          <p className="text-xs text-muted-foreground">No linked entities in view.</p>
        ) : (
          <ul className="space-y-1">
            {selectedNeighbors.map(({ node, relationship }) => (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => onSelect(node)}
                  className="group flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left hover:border-border hover:bg-muted/50"
                >
                  <span
                    className="mt-1 h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: colorFor(node) }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{node.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {node.group}
                      {relationship && ` · ${relationship}`}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>
    </div>
  );
}

// ──────────────────────────────────────────────
// Shared building blocks
// ──────────────────────────────────────────────

function DetailSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function KeyValueRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 py-0.5 text-[11px]">
      <span className="text-muted-foreground">{k}</span>
      <span className="truncate font-medium">{v}</span>
    </div>
  );
}

/**
 * Collapsed raw-JSON metadata view. Uses the native <details> element so the
 * detail panel isn't flooded with JSON on first open.
 */
function MetadataDetails({ metadata }: { metadata: Record<string, unknown> }) {
  return (
    <details className="rounded-md bg-muted/50 p-2 text-[10px] text-muted-foreground">
      <summary className="cursor-pointer select-none text-[10px] font-medium text-muted-foreground">
        View metadata
      </summary>
      <pre className="mt-2 whitespace-pre-wrap break-words">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    </details>
  );
}
