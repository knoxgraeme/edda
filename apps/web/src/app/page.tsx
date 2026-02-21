/**
 * Main chat page — the primary Edda interface
 */

import { Suspense } from "react";
import { ChatPageClient } from "./components/ChatPageClient";

export default function ChatPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ChatPageClient />
    </Suspense>
  );
}
