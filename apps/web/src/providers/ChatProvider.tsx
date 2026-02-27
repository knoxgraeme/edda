"use client";

/**
 * Chat provider — wires useEdda into React context
 *
 * Manages: messages, streaming state, thread lifecycle.
 * Exposes useChatContext() for consumption in child components.
 */

import { createContext, useContext } from "react";
import { useEdda } from "@/app/hooks/useEdda";
import { useEddaThreads } from "@/app/hooks/useEddaThreads";
import type { Message } from "@/app/types/types";

interface ChatContextType {
  messages: Message[];
  isLoading: boolean;
  threadId: string | null;
  isResolvingThread: boolean;
  submit: (content: string) => Promise<void>;
  stop: () => void;
  loadThread: (threadId: string) => Promise<void>;
  mutateThreads: () => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

export function ChatProvider({
  agentName,
  children,
}: {
  agentName: string;
  children: React.ReactNode;
}) {
  const edda = useEdda(agentName);
  const { mutate: mutateThreads } = useEddaThreads(agentName);

  // Wrap submit to also refresh the thread list after the stream completes
  const submitWithRefresh = async (content: string) => {
    await edda.submit(content);
    mutateThreads();
  };

  return (
    <ChatContext.Provider
      value={{
        messages: edda.messages,
        isLoading: edda.isLoading,
        threadId: edda.threadId,
        isResolvingThread: edda.isResolvingThread,
        submit: submitWithRefresh,
        stop: edda.stop,
        loadThread: edda.loadThread,
        mutateThreads,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext(): ChatContextType {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return ctx;
}
