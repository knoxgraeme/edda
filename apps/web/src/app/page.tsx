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
// import { ChatInterface } from "./components/ChatInterface";

export default function ChatPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <main className="flex h-screen">
        {/* TODO: Port ChatInterface from deep-agents-ui */}
        <div className="flex-1 flex items-center justify-center text-gray-400">
          Edda Chat — scaffold ready. Port components from deep-agents-ui.
        </div>
      </main>
    </Suspense>
  );
}
