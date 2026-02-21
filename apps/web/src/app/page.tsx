/**
 * Main chat page — the primary Edda interface
 *
 * Forked from deep-agents-ui. Includes:
 * - Chat interface with streaming via useStream (LangGraph SDK)
 * - Tool call visualization
 * - Sub-agent indicators
 * - Planning step display (tasks sidebar)
 * - Human-in-the-loop tool approval interrupts
 * - File display sidebar
 */

import { Suspense } from "react";
import { ChatInterface } from "./components/ChatInterface";

export default function ChatPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <main className="flex h-screen">
        <ChatInterface />
      </main>
    </Suspense>
  );
}
