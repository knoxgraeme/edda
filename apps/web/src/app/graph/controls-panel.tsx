"use client";

import { useEffect, useState } from "react";

interface ControlsPanelProps {
  entityLimit: number;
  itemsPerEntity: number;
  onEntityLimitChange: (value: number) => void;
  onItemsPerEntityChange: (value: number) => void;
}

/**
 * Sliders for entity count and items-per-entity.
 *
 * Uses a local draft state while the user is dragging and only commits the
 * value to the parent (which triggers a refetch) on `pointerup`/`mouseup`/
 * `touchend`/`keyup`/`blur`. Dragging a slider from end to end issues exactly
 * one API request, not one per tick.
 */
export function ControlsPanel({
  entityLimit,
  itemsPerEntity,
  onEntityLimitChange,
  onItemsPerEntityChange,
}: ControlsPanelProps) {
  const [draftEntities, setDraftEntities] = useState(entityLimit);
  const [draftItems, setDraftItems] = useState(itemsPerEntity);

  // Keep local draft in sync when the parent value changes externally
  // (e.g. on initial mount or a programmatic reset).
  useEffect(() => {
    setDraftEntities(entityLimit);
  }, [entityLimit]);
  useEffect(() => {
    setDraftItems(itemsPerEntity);
  }, [itemsPerEntity]);

  const commitEntities = () => {
    if (draftEntities !== entityLimit) onEntityLimitChange(draftEntities);
  };
  const commitItems = () => {
    if (draftItems !== itemsPerEntity) onItemsPerEntityChange(draftItems);
  };

  return (
    <div className="absolute left-4 top-16 z-10 w-64 rounded-lg border border-border bg-background/95 p-4 shadow-lg backdrop-blur">
      <div className="space-y-4">
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
      </div>
    </div>
  );
}
