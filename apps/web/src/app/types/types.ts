export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "pending" | "completed" | "error" | "interrupted";
}

export interface ThreadItem {
  id: string;
  title: string;
  description?: string;
  updatedAt: Date;
  status: "idle" | "busy" | "interrupted" | "error";
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string }
  | { type: string; [key: string]: unknown };

// SDKToolCall represents one of three tool call wire formats:
//   1. OpenAI  — { id, function: { name, arguments } }
//   2. LangChain — { id, name, args }
//   3. Anthropic — { type: "tool_use", id, name, input }
// At least one of (name | function.name) must be present on a valid tool call.
export type SDKToolCall =
  | {
      // OpenAI format
      id?: string;
      type?: string;
      name?: never;
      args?: never;
      input?: never;
      function: { name: string; arguments?: unknown };
    }
  | {
      // LangChain format
      id?: string;
      type?: string;
      name: string;
      args?: Record<string, unknown>;
      input?: never;
      function?: never;
    }
  | {
      // Anthropic format
      id?: string;
      type: string;
      name: string;
      input?: Record<string, unknown>;
      args?: never;
      function?: never;
    };

export interface Message {
  id: string;
  type: "human" | "ai" | "tool" | "system";
  content: string | ContentBlock[];
  tool_calls?: SDKToolCall[];
  tool_call_id?: string;
  additional_kwargs?: Record<string, unknown>;
  name?: string;
}
