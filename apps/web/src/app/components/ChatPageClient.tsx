"use client";

import { useState, useCallback } from "react";
import { History, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatInterface } from "./ChatInterface";
import { ThreadList } from "./ThreadList";
import { useChatContext } from "@/providers/ChatProvider";

export function ChatPageClient() {
  const [showThreads, setShowThreads] = useState(false);
  const { threadId, loadThread, newThread } = useChatContext();

  const handleThreadSelect = useCallback(
    (id: string) => {
      void loadThread(id);
      setShowThreads(false);
    },
    [loadThread],
  );

  return (
    <main className="flex h-screen">
      {/* Thread sidebar */}
      {showThreads && (
        <div className="relative w-72 flex-shrink-0 border-r border-border bg-muted/30">
          <ThreadList
            currentThreadId={threadId}
            onThreadSelect={handleThreadSelect}
            onClose={() => setShowThreads(false)}
          />
        </div>
      )}

      {/* Chat area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowThreads((prev) => !prev)}
            title="Toggle thread history"
            className="h-8 gap-1.5 px-2"
          >
            <History className="h-4 w-4" />
            <span className="text-xs">History</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={newThread}
            title="New chat"
            className="h-8 gap-1.5 px-2"
          >
            <Plus className="h-4 w-4" />
            <span className="text-xs">New chat</span>
          </Button>
        </div>

        <ChatInterface />
      </div>
    </main>
  );
}
