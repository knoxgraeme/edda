"use client";

import { ENTITY_COLORS, colorFor } from "./graph-types";

interface LegendProps {
  groups: { entities: string[]; items: string[] };
}

export function Legend({ groups }: LegendProps) {
  if (groups.entities.length === 0 && groups.items.length === 0) return null;

  return (
    <div className="absolute bottom-4 left-4 z-10 max-w-xs rounded-lg border border-border bg-background/90 p-3 shadow-sm backdrop-blur">
      {groups.entities.length > 0 && (
        <>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Entities
          </p>
          <div className="flex flex-wrap gap-1.5">
            {groups.entities.map((g) => (
              <div key={g} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: ENTITY_COLORS[g] ?? "#a78bfa" }}
                />
                <span className="text-[11px] text-muted-foreground">{g}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {groups.items.length > 0 && (
        <>
          <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Items
          </p>
          <div className="flex flex-wrap gap-1.5">
            {groups.items.map((g) => (
              <div key={g} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: colorFor({ kind: "item", group: g }) }}
                />
                <span className="text-[11px] text-muted-foreground">{g}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
