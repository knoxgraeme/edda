"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Message } from "@/app/types/types";

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

export function useEdda(agentName: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isResolvingThread, setIsResolvingThread] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  // Resolve thread ID from server on mount / agent change
  useEffect(() => {
    let cancelled = false;
    setIsResolvingThread(true);
    setMessages([]);
    setThreadId(null);

    (async () => {
      try {
        const res = await fetch(`/api/v1/agents/${encodeURIComponent(agentName)}/thread`);
        if (!res.ok) throw new Error(`Failed to resolve thread: ${res.status}`);
        const data = (await res.json()) as { thread_id: string };
        if (cancelled) return;
        setThreadId(data.thread_id);

        // Load existing messages for this thread
        const msgRes = await fetch(`/api/v1/threads/${encodeURIComponent(data.thread_id)}/messages`);
        if (msgRes.ok) {
          const loaded = (await msgRes.json()) as Message[];
          if (!cancelled) setMessages(loaded);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[useEdda] Thread resolution failed:", err);
        }
      } finally {
        if (!cancelled) setIsResolvingThread(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentName]);

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
        const response = await fetch(`/api/v1/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [userMessage],
            agent_name: agentName,
            ...(threadId ? { thread_id: threadId } : {}),
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

                // Handle thread_id resolution event
                if (
                  data !== null &&
                  typeof data === "object" &&
                  "thread_id" in (data as Record<string, unknown>)
                ) {
                  const resolved = (data as { thread_id: string }).thread_id;
                  setThreadId(resolved);
                  continue;
                }

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
    [agentName, threadId],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const loadThread = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/v1/threads/${encodeURIComponent(id)}/messages`);
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

  return { messages, isLoading, threadId, isResolvingThread, submit, stop, loadThread };
}
