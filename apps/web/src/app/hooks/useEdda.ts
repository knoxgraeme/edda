"use client";

import { useState, useCallback, useRef } from "react";
import type { Message } from "@/app/types/types";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8000";

function mergeMessageChunk(messages: Message[], chunk: Message): Message[] {
  const existingIndex = messages.findIndex((m) => m.id === chunk.id);
  if (existingIndex === -1) {
    return [...messages, chunk];
  }
  const existing = messages[existingIndex];
  // Merge content: if both are strings, concatenate; otherwise replace
  let mergedContent: Message["content"];
  if (typeof existing.content === "string" && typeof chunk.content === "string") {
    mergedContent = existing.content + chunk.content;
  } else {
    mergedContent = chunk.content || existing.content;
  }
  const merged: Message = {
    ...existing,
    ...chunk,
    content: mergedContent,
    tool_calls: chunk.tool_calls ?? existing.tool_calls,
    additional_kwargs: {
      ...existing.additional_kwargs,
      ...chunk.additional_kwargs,
    },
  };
  const updated = [...messages];
  updated[existingIndex] = merged;
  return updated;
}

export function useEdda() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID());
  const abortRef = useRef<AbortController | null>(null);

  const submit = useCallback(
    async (content: string) => {
      const userMessage: Message = {
        id: crypto.randomUUID(),
        type: "human",
        content,
      };

      // Optimistic update — show user message immediately
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      abortRef.current = new AbortController();

      try {
        const response = await fetch(`${SERVER_URL}/api/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [userMessage],
            thread_id: threadId,
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error("Response body is null");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          // Collect all chunks from this read() call, then apply a single setState
          const chunksToMerge: Message[] = [];
          let errorMsg: Message | null = null;

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const raw = line.slice(6).trim();
              if (!raw || raw === "[DONE]") continue;
              try {
                const data = JSON.parse(raw) as unknown;
                // LangGraph streamMode: ["messages", "updates"] produces [streamMode, chunkData] tuples
                if (Array.isArray(data) && data.length === 2) {
                  const [streamMode, chunkData] = data as [string, unknown];
                  if (streamMode === "messages") {
                    // chunkData is [messageChunk, metadata]
                    if (Array.isArray(chunkData) && chunkData.length >= 1) {
                      const msgChunk = chunkData[0] as Partial<Message>;
                      if (msgChunk && msgChunk.id) {
                        chunksToMerge.push({
                          id: msgChunk.id,
                          type: (msgChunk.type as Message["type"]) ?? "ai",
                          content: msgChunk.content ?? "",
                          tool_calls: msgChunk.tool_calls,
                          tool_call_id: msgChunk.tool_call_id,
                          additional_kwargs: msgChunk.additional_kwargs,
                          name: msgChunk.name,
                        });
                      }
                    }
                  }
                  // "updates" mode — ignore for now
                } else if (
                  data !== null &&
                  typeof data === "object" &&
                  "error" in (data as Record<string, unknown>)
                ) {
                  // Server-sent error
                  const errorData = data as Record<string, unknown>;
                  errorMsg = {
                    id: crypto.randomUUID(),
                    type: "system",
                    content: String(errorData.error),
                  };
                }
              } catch {
                // Skip unparseable lines
              }
            }
          }

          // Single setState per chunk — avoids one render per SSE line
          if (chunksToMerge.length > 0 || errorMsg) {
            setMessages((prev) => {
              let updated = prev;
              for (const chunk of chunksToMerge) {
                updated = mergeMessageChunk(updated, chunk);
              }
              if (errorMsg) {
                updated = [...updated, errorMsg];
              }
              return updated;
            });
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          const errorMsg: Message = {
            id: crypto.randomUUID(),
            type: "system",
            content: `Error: ${(err as Error).message}`,
          };
          setMessages((prev) => [...prev, errorMsg]);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [threadId]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newThread = useCallback(() => {
    setThreadId(crypto.randomUUID());
    setMessages([]);
  }, []);

  const loadThread = useCallback(async (id: string) => {
    try {
      const response = await fetch(`${SERVER_URL}/api/threads/${id}`);
      if (!response.ok) {
        throw new Error(`Failed to load thread: ${response.status}`);
      }
      const loaded = (await response.json()) as Message[];
      setThreadId(id);
      setMessages(loaded);
    } catch (err) {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        type: "system",
        content: `Error loading thread: ${(err as Error).message}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  }, []);

  return { messages, isLoading, threadId, submit, stop, newThread, loadThread };
}
