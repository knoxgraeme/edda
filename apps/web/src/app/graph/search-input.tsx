"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Presentational search input with a leading Lucide Search icon.
 *
 * Debouncing is the parent's responsibility — this component commits every
 * keystroke synchronously via `onChange`. The parent (`graph-client.tsx`)
 * holds a draft state and runs a 300ms `useEffect` timeout before triggering
 * the data refetch, so typing "alice" issues exactly one request.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search entities...",
  className,
}: SearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 pl-8 text-xs"
      />
    </div>
  );
}
