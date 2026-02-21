"use client";

import React from "react";
import { ToolCallBox } from "@/app/components/ToolCallBox";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import type { ToolCall, Message } from "@/app/types/types";
import { extractStringFromMessageContent } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  message: Message;
  toolCalls: ToolCall[];
}

export const ChatMessage = React.memo<ChatMessageProps>(({ message, toolCalls }) => {
  const isUser = message.type === "human";
  const messageContent = extractStringFromMessageContent(message);
  const hasContent = messageContent && messageContent.trim() !== "";
  const hasToolCalls = toolCalls.length > 0;

  return (
    <div
      className={cn("flex w-full max-w-full overflow-x-hidden", isUser && "flex-row-reverse")}
    >
      <div className={cn("min-w-0 max-w-full", isUser ? "max-w-[70%]" : "w-full")}>
        {hasContent && (
          <div className={cn("relative flex items-end gap-0")}>
            <div
              className={cn(
                "mt-4 overflow-hidden break-words text-sm font-normal leading-[150%]",
                isUser
                  ? "rounded-xl rounded-br-none border border-border px-3 py-2 text-foreground"
                  : "text-primary"
              )}
              style={
                isUser ? { backgroundColor: "var(--color-user-message-bg)" } : undefined
              }
            >
              {isUser ? (
                <p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {messageContent}
                </p>
              ) : (
                <MarkdownContent content={messageContent} />
              )}
            </div>
          </div>
        )}
        {hasToolCalls && (
          <div className="mt-4 flex w-full flex-col">
            {toolCalls.map((toolCall: ToolCall) => (
              <ToolCallBox key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

ChatMessage.displayName = "ChatMessage";
