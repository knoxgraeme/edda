"use client";

/**
 * Chat provider — wraps useStream from LangGraph SDK
 *
 * Manages: messages, todos, files, streaming state, interrupts.
 * Ported from deep-agents-ui's useChat hook pattern.
 */

import { createContext, useContext } from "react";

interface ChatContextType {
  // TODO: Wire up useStream from @langchain/langgraph-sdk/react
  // See deep-agents-ui src/app/hooks/useChat.ts for reference
  messages: unknown[];
  isLoading: boolean;
  sendMessage: (content: string) => void;
}

const ChatContext = createContext<ChatContextType>({
  messages: [],
  isLoading: false,
  sendMessage: () => {},
});

export function ChatProvider({ children }: { children: React.ReactNode }) {
  // TODO: Initialize useStream<StateType> here
  // StateType includes: messages, todos, files, email, ui

  return (
    <ChatContext.Provider
      value={{
        messages: [],
        isLoading: false,
        sendMessage: () => console.log("Chat not wired up yet"),
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  return useContext(ChatContext);
}
