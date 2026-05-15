"use client";

import { useEffect, useState } from "react";
import { Briefcase, Building2, Hash, Lightbulb, MapPin, User, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { ENTITY_COLORS, ENTITY_TYPE_VALUES, type EntityType } from "./graph-types";

interface ControlsPanelProps {
  entityLimit: number;
  itemsPerEntity: number;
  minItemLinks: number;
  /** d3-force charge strength. More negative = more node repulsion. */
  chargeStrength: number;
  /** d3-force link distance in graph units. Higher = longer edges. */
  linkDistance: number;
  onEntityLimitChange: (value: number) => void;
  onItemsPerEntityChange: (value: number) => void;
  onMinItemLinksChange: (value: number) => void;
  onChargeStrengthChange: (value: number) => void;
  onLinkDistanceChange: (value: number) => void;
  // Type-filter state
  selectedTypes: Set<EntityType>;
  onSelectedTypesChange: (next: Set<EntityType>) => void;
  /** Live counts per type from the current graph data. Missing = 0. */
  typeCounts: Record<string, number>;
}

const TYPE_ICONS: Record<EntityType, React.ComponentType<{ className?: string }>> = {
  person: User,
  project: Briefcase,
  company: Building2,
  topic: Hash,
  place: MapPin,
  tool: Wrench,
  concept: Lightbulb,
};

/**
 * Sliders for entity count and items-per-entity, plus multi-select type
 * filter pills.
 *
 * Sliders use a local draft state while the user is dragging and only commit
 * the value to the parent (which triggers a refetch) on `pointerup`/`mouseup`/
 * `touchend`/`keyup`/`blur`. Dragging a slider from end to end issues exactly
 * one API request, not one per tick.
 *
 * Type-filter pill clicks commit immediately — a single click should never
 * feel laggy.
 */
export function ControlsPanel({
  entityLimit,
  itemsPerEntity,
  minItemLinks,
  chargeStrength,
  linkDistance,
  onEntityLimitChange,
  onItemsPerEntityChange,
  onMinItemLinksChange,
  onChargeStrengthChange,
  onLinkDistanceChange,
  selectedTypes,
  onSelectedTypesChange,
  typeCounts,
}: ControlsPanelProps) {
  const [draftEntities, setDraftEntities] = useState(entityLimit);
  const [draftItems, setDraftItems] = useState(itemsPerEntity);
  const [draftMinLinks, setDraftMinLinks] = useState(minItemLinks);
  const [draftCharge, setDraftCharge] = useState(chargeStrength);
  const [draftLinkDist, setDraftLinkDist] = useState(linkDistance);

  // Keep local draft in sync when the parent value changes externally
  // (e.g. on initial mount or a programmatic reset).
  useEffect(() => {
    setDraftEntities(entityLimit);
  }, [entityLimit]);
  useEffect(() => {
    setDraftItems(itemsPerEntity);
  }, [itemsPerEntity]);
  useEffect(() => {
    setDraftMinLinks(minItemLinks);
  }, [minItemLinks]);
  useEffect(() => {
    setDraftCharge(chargeStrength);
  }, [chargeStrength]);
  useEffect(() => {
    setDraftLinkDist(linkDistance);
  }, [linkDistance]);

  const commitEntities = () => {
    if (draftEntities !== entityLimit) onEntityLimitChange(draftEntities);
  };
  const commitItems = () => {
    if (draftItems !== itemsPerEntity) onItemsPerEntityChange(draftItems);
  };
  const commitMinLinks = () => {
    if (draftMinLinks !== minItemLinks) onMinItemLinksChange(draftMinLinks);
  };
  const commitCharge = () => {
    if (draftCharge !== chargeStrength) onChargeStrengthChange(draftCharge);
  };
  const commitLinkDist = () => {
    if (draftLinkDist !== linkDistance) onLinkDistanceChange(draftLinkDist);
  };

  const allSelected = selectedTypes.size === ENTITY_TYPE_VALUES.length;

  const toggleType = (type: EntityType) => {
    const next = new Set(selectedTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onSelectedTypesChange(next);
  };

  const toggleAll = () => {
    if (allSelected) {
      onSelectedTypesChange(new Set());
    } else {
      onSelectedTypesChange(new Set(ENTITY_TYPE_VALUES));
    }
  };

  return (
    <div className="absolute left-4 top-16 z-10 w-72 rounded-lg border border-border bg-background/95 p-4 shadow-lg backdrop-blur">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium">Filter by type</label>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={toggleAll}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                allSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              All
            </button>
            {ENTITY_TYPE_VALUES.map((type) => {
              const Icon = TYPE_ICONS[type];
              const active = selectedTypes.has(type);
              const count = typeCounts[type] ?? 0;
              const empty = count === 0;
              const color = ENTITY_COLORS[type] ?? "#a78bfa";
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted",
                    empty && !active && "opacity-50",
                  )}
                  title={`${type}${empty ? " (no matches in current view)" : ""}`}
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <Icon className="h-3 w-3" />
                  {type} ({count})
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="graph-entity-limit" className="text-xs font-medium">
              Top entities
            </label>
            <span className="text-xs text-muted-foreground">{draftEntities}</span>
          </div>
          <input
            id="graph-entity-limit"
            type="range"
            min={10}
            max={200}
            step={10}
            value={draftEntities}
            onChange={(e) => setDraftEntities(Number(e.target.value))}
            onPointerUp={commitEntities}
            onMouseUp={commitEntities}
            onTouchEnd={commitEntities}
            onKeyUp={commitEntities}
            onBlur={commitEntities}
            className="w-full"
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="graph-items-per-entity" className="text-xs font-medium">
              Items per entity
            </label>
            <span className="text-xs text-muted-foreground">{draftItems}</span>
          </div>
          <input
            id="graph-items-per-entity"
            type="range"
            min={0}
            max={20}
            step={1}
            value={draftItems}
            onChange={(e) => setDraftItems(Number(e.target.value))}
            onPointerUp={commitItems}
            onMouseUp={commitItems}
            onTouchEnd={commitItems}
            onKeyUp={commitItems}
            onBlur={commitItems}
            className="w-full"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Set to 0 for entity-only view
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="graph-min-links" className="text-xs font-medium">
              Min item connections
            </label>
            <span className="text-xs text-muted-foreground">{draftMinLinks}</span>
          </div>
          <input
            id="graph-min-links"
            type="range"
            min={1}
            max={5}
            step={1}
            value={draftMinLinks}
            onChange={(e) => setDraftMinLinks(Number(e.target.value))}
            onPointerUp={commitMinLinks}
            onMouseUp={commitMinLinks}
            onTouchEnd={commitMinLinks}
            onKeyUp={commitMinLinks}
            onBlur={commitMinLinks}
            className="w-full"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Hide items with fewer than N total entity links
          </p>
        </div>

        <div className="border-t border-border pt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Layout forces
          </p>

          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="graph-charge" className="text-xs font-medium">
                Repel strength
              </label>
              <span className="text-xs text-muted-foreground">{draftCharge}</span>
            </div>
            <input
              id="graph-charge"
              type="range"
              min={-200}
              max={-5}
              step={5}
              value={draftCharge}
              onChange={(e) => setDraftCharge(Number(e.target.value))}
              onPointerUp={commitCharge}
              onMouseUp={commitCharge}
              onTouchEnd={commitCharge}
              onKeyUp={commitCharge}
              onBlur={commitCharge}
              className="w-full"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              More negative = nodes push apart harder
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="graph-link-distance" className="text-xs font-medium">
                Link distance
              </label>
              <span className="text-xs text-muted-foreground">{draftLinkDist}</span>
            </div>
            <input
              id="graph-link-distance"
              type="range"
              min={10}
              max={200}
              step={5}
              value={draftLinkDist}
              onChange={(e) => setDraftLinkDist(Number(e.target.value))}
              onPointerUp={commitLinkDist}
              onMouseUp={commitLinkDist}
              onTouchEnd={commitLinkDist}
              onKeyUp={commitLinkDist}
              onBlur={commitLinkDist}
              className="w-full"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Preferred edge length between connected nodes
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
