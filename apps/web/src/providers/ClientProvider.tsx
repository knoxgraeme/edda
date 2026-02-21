"use client";

/**
 * LangGraph SDK client provider
 *
 * Initializes the LangGraph client that connects to the Edda server.
 * Provides the client to all child components via React Context.
 */

import { createContext, useContext, useMemo } from "react";
import { Client } from "@langchain/langgraph-sdk";

interface ClientContextType {
  client: Client | null;
}

const ClientContext = createContext<ClientContextType>({ client: null });

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_LANGGRAPH_URL || "http://localhost:3001";
    return new Client({ apiUrl: url });
  }, []);

  return (
    <ClientContext.Provider value={{ client }}>
      {children}
    </ClientContext.Provider>
  );
}

export function useClient() {
  return useContext(ClientContext);
}
