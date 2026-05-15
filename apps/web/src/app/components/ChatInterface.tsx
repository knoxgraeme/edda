"use client";

import React, { useState, useRef, useCallback, useMemo, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Square, ArrowUp, MessageSquare, Search, CalendarDays, BookOpen } from "lucide-react";
import { ChatMessage } from "@/app/components/ChatMessage";
import type { ToolCall, Message, SDKToolCall } from "@/app/types/types";
import { extractStringFromMessageContent } from "@/lib/utils";
import { useChatContext } from "@/providers/ChatProvider";
import { cn } from "@/lib/utils";
import { useStickToBottom } from "use-stick-to-bottom";

function ThinkingIndicator() {
  return (
    <div className="mt-4 flex items-center gap-1 py-2">
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50" />
    </div>
  );
}

interface ChatInterfaceProps {
  /**
   * When true, suppresses the big "Edda / Your AI second brain" welcome
   * block shown in the empty state. Set this when embedding ChatInterface
   * inside a page that already has its own header (e.g. `/agents/[name]`
   * Mission Control), so the composer sits at the top of the pane.
   */
  hideWelcome?: boolean;
}

export const ChatInterface = React.memo(function ChatInterface({
  hideWelcome = false,
}: ChatInterfaceProps = {}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [input, setInput] = useState("");
  const { scrollRef, contentRef } = useStickToBottom();

  const { messages, isLoading, submit, stop } = useChatContext();

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      if (e) {
        e.preventDefault();
      }
      const messageText = input.trim();
      if (!messageText || isLoading) return;
      void submit(messageText);
      setInput("");
    },
    [input, isLoading, submit]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const suggestedPrompts = useMemo(
    () => [
      { icon: CalendarDays, text: "What's on my schedule today?" },
      { icon: BookOpen, text: "Remember that I prefer..." },
      { icon: Search, text: "Search my notes about..." },
      { icon: MessageSquare, text: "Show me a daily summary" },
    ],
    []
  );

  const handlePromptClick = useCallback(
    (text: string) => {
      setInput(text);
      // Focus the textarea so the user can edit or just hit Enter
      textareaRef.current?.focus();
    },
    []
  );

  // Correlate AI messages with tool result messages to build { message, toolCalls }[] structure.
  // Handles three tool call formats:
  //   1. OpenAI: message.additional_kwargs.tool_calls (array of {id, function: {name, arguments}})
  //   2. LangChain: message.tool_calls (array of {id, name, args})
  //   3. Anthropic: message.content array with {type: "tool_use"} blocks
  const processedMessages = useMemo(() => {
    // Build a reverse index: tool_call_id → tool result message (O(N) pre-pass, O(1) lookup)
    const toolResultIndex = new Map<string, Message>();
    for (const msg of messages) {
      if (msg.type === "tool" && msg.tool_call_id) {
        toolResultIndex.set(msg.tool_call_id, msg);
      }
    }

    const messageMap = new Map<string, { message: Message; toolCalls: ToolCall[] }>();

    messages.forEach((message: Message) => {
      if (message.type === "ai") {
        const toolCallsInMessage: SDKToolCall[] = [];

        if (
          message.additional_kwargs?.tool_calls &&
          Array.isArray(message.additional_kwargs.tool_calls)
        ) {
          toolCallsInMessage.push(
            ...(message.additional_kwargs.tool_calls as SDKToolCall[])
          );
        } else if (message.tool_calls && Array.isArray(message.tool_calls)) {
          toolCallsInMessage.push(
            ...message.tool_calls.filter((tc: SDKToolCall) => tc.name !== "")
          );
        } else if (Array.isArray(message.content)) {
          const toolUseBlocks = message.content.filter(
            (block) =>
              typeof block === "object" && block !== null && "type" in block && block.type === "tool_use"
          );
          toolCallsInMessage.push(...(toolUseBlocks as SDKToolCall[]));
        }

        const toolCallsWithStatus: ToolCall[] = toolCallsInMessage.map((toolCall, toolCallIndex) => {
          const name =
            toolCall.function?.name || toolCall.name || toolCall.type || "unknown";
          const rawArgs = toolCall.function?.arguments || toolCall.args || toolCall.input || {};
          const args: Record<string, unknown> =
            typeof rawArgs === "string"
              ? (() => {
                  try {
                    return JSON.parse(rawArgs) as Record<string, unknown>;
                  } catch {
                    return { raw: rawArgs };
                  }
                })()
              : (rawArgs as Record<string, unknown>);
          // Use server-assigned id if present; otherwise derive a stable deterministic id
          const id = toolCall.id ?? `${message.id}-tool-${toolCallIndex}`;
          // O(1) lookup for tool result using the reverse index
          const toolResult = toolResultIndex.get(id);
          return {
            id,
            name: name ?? "unknown",
            args,
            status: toolResult ? ("completed" as const) : ("pending" as const),
            result: toolResult ? extractStringFromMessageContent(toolResult) : undefined,
          };
        });

        messageMap.set(message.id, {
          message,
          toolCalls: toolCallsWithStatus,
        });
      } else if (message.type === "human" || message.type === "system") {
        messageMap.set(message.id, {
          message,
          toolCalls: [],
        });
      }
      // tool messages are consumed via toolResultIndex above; skip adding them to messageMap
    });

    return Array.from(messageMap.values());
  }, [messages]);

  const hasMessages = processedMessages.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        ref={scrollRef}
      >
        <div className="mx-auto w-full max-w-[1024px] px-6 pb-6 pt-4" ref={contentRef}>
          {!hasMessages ? (
            hideWelcome ? (
              // Embedded mode: just a compact prompt-suggestion row.
              // The page host (e.g. Mission Control) owns the heading.
              <div className="flex flex-wrap gap-1.5 pt-2">
                {suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt.text}
                    type="button"
                    onClick={() => handlePromptClick(prompt.text)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:bg-muted hover:text-foreground"
                  >
                    <prompt.icon className="h-3 w-3 flex-shrink-0" />
                    {prompt.text}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[60vh] flex-col items-center justify-center pb-12">
                <h1 className="text-3xl font-semibold tracking-tight text-primary">Edda</h1>
                <p className="mt-1 text-sm text-muted-foreground">Your AI second brain</p>
                <p className="mt-4 max-w-sm text-center text-sm text-muted-foreground/80">
                  Capture thoughts, recall memories, and let agents work for you.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-2">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt.text}
                      type="button"
                      onClick={() => handlePromptClick(prompt.text)}
                      className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:bg-muted hover:text-primary"
                    >
                      <prompt.icon className="h-3.5 w-3.5 flex-shrink-0" />
                      {prompt.text}
                    </button>
                  ))}
                </div>
              </div>
            )
          ) : (
            processedMessages.map((data) => (
              <ChatMessage
                key={data.message.id}
                message={data.message}
                toolCalls={data.toolCalls}
              />
            ))
          )}
          {isLoading && <ThinkingIndicator />}
        </div>
      </div>

      <div className="flex-shrink-0 bg-background">
        <div
          className={cn(
            "mx-4 mb-6 flex flex-shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background",
            "mx-auto w-[calc(100%-32px)] max-w-[1024px] transition-colors duration-200 ease-in-out"
          )}
        >
          <form onSubmit={handleSubmit} className="flex flex-col">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isLoading ? "Running..." : "Write your message..."}
              className="font-inherit field-sizing-content flex-1 resize-none border-0 bg-transparent px-[18px] pb-[13px] pt-[14px] text-sm leading-7 text-primary outline-none placeholder:text-muted-foreground"
              rows={1}
            />
            <div className="flex justify-between gap-2 p-3">
              <div className="flex justify-end gap-2">
                <Button
                  type={isLoading ? "button" : "submit"}
                  variant={isLoading ? "destructive" : "default"}
                  onClick={isLoading ? stop : handleSubmit}
                  disabled={!isLoading && !input.trim()}
                >
                  {isLoading ? (
                    <>
                      <Square size={14} />
                      <span>Stop</span>
                    </>
                  ) : (
                    <>
                      <ArrowUp size={18} />
                      <span>Send</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
});

ChatInterface.displayName = "ChatInterface";
