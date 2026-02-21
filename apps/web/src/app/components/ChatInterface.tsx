"use client";

import React, { useState, useRef, useCallback, useMemo, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Square, ArrowUp } from "lucide-react";
import { ChatMessage } from "@/app/components/ChatMessage";
import type { ToolCall, Message, SDKToolCall } from "@/app/types/types";
import { extractStringFromMessageContent } from "@/lib/utils";
import { useChatContext } from "@/providers/ChatProvider";
import { cn } from "@/lib/utils";
import { useStickToBottom } from "use-stick-to-bottom";

export const ChatInterface = React.memo(function ChatInterface() {
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
      } else if (message.type === "human") {
        messageMap.set(message.id, {
          message,
          toolCalls: [],
        });
      }
      // tool messages are consumed via toolResultIndex above; skip adding them to messageMap
    });

    return Array.from(messageMap.values());
  }, [messages]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        ref={scrollRef}
      >
        <div className="mx-auto w-full max-w-[1024px] px-6 pb-6 pt-4" ref={contentRef}>
          {processedMessages.map((data) => (
            <ChatMessage
              key={data.message.id}
              message={data.message}
              toolCalls={data.toolCalls}
            />
          ))}
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
