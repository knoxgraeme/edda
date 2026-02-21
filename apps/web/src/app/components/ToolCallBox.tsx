"use client";

import React, { useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronUp,
  Terminal,
  AlertCircle,
  Loader2,
  CircleCheckBig,
  StopCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ToolCall } from "@/app/types/types";
import { cn } from "@/lib/utils";

interface ToolCallBoxProps {
  toolCall: ToolCall;
}

function getStatusIcon(status: ToolCall["status"]) {
  switch (status) {
    case "completed":
      return <CircleCheckBig size={14} className="text-green-500" />;
    case "error":
      return <AlertCircle size={14} className="text-destructive" />;
    case "pending":
      return <Loader2 size={14} className="animate-spin" />;
    case "interrupted":
      return <StopCircle size={14} className="text-orange-500" />;
    default:
      return <Terminal size={14} className="text-muted-foreground" />;
  }
}

export const ToolCallBox = React.memo<ToolCallBoxProps>(({ toolCall }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedArgs, setExpandedArgs] = useState<Record<string, boolean>>({});

  const { name, args, result, status } = toolCall;
  const displayName = name || "Unknown Tool";
  const displayArgs = args || {};

  const toggleExpanded = () => setIsExpanded((prev) => !prev);

  const toggleArgExpanded = useCallback((argKey: string) => {
    setExpandedArgs((prev) => ({
      ...prev,
      [argKey]: !prev[argKey],
    }));
  }, []);

  const hasContent = result || Object.keys(displayArgs).length > 0;

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-lg border-none shadow-none outline-none transition-colors duration-200 hover:bg-accent",
        isExpanded && hasContent && "bg-accent"
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleExpanded}
        className={cn(
          "flex w-full items-center justify-between gap-2 border-none px-2 py-2 text-left shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-default"
        )}
        disabled={!hasContent}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {getStatusIcon(status)}
            <span className="text-[15px] font-medium tracking-[-0.6px] text-foreground">
              {displayName}
            </span>
          </div>
          {hasContent &&
            (isExpanded ? (
              <ChevronUp size={14} className="shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
            ))}
        </div>
      </Button>

      {isExpanded && hasContent && (
        <div className="px-4 pb-4">
          {Object.keys(displayArgs).length > 0 && (
            <div className="mt-4">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Arguments
              </h4>
              <div className="space-y-2">
                {Object.entries(displayArgs).map(([key, value]) => (
                  <div key={key} className="rounded-sm border border-border">
                    <button
                      onClick={() => toggleArgExpanded(key)}
                      className="flex w-full items-center justify-between bg-muted/30 p-2 text-left text-xs font-medium transition-colors hover:bg-muted/50"
                    >
                      <span className="font-mono">{key}</span>
                      {expandedArgs[key] ? (
                        <ChevronUp size={12} className="text-muted-foreground" />
                      ) : (
                        <ChevronDown size={12} className="text-muted-foreground" />
                      )}
                    </button>
                    {expandedArgs[key] && (
                      <div className="border-t border-border bg-muted/20 p-2">
                        <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-6 text-foreground">
                          {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {result && (
            <div className="mt-4">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Result
              </h4>
              <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-all rounded-sm border border-border bg-muted/40 p-2 font-mono text-xs leading-7 text-foreground">
                {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

ToolCallBox.displayName = "ToolCallBox";
