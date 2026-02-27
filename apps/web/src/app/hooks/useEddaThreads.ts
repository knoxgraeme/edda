"use client";

import useSWR from "swr";
import type { ThreadItem } from "@/app/types/types";

async function fetcher(url: string): Promise<ThreadItem[]> {
  const response = await fetch(url);
  if (!response.ok) {
    // Handle 404 gracefully — server endpoint not yet implemented
    if (response.status === 404) {
      return [];
    }
    throw new Error(`Failed to fetch threads: ${response.status}`);
  }
  const json = (await response.json()) as { data: unknown[] };
  const data = json.data ?? [];
  // Normalize dates from server response
  return data.map((t: unknown) => {
    const thread = t as Record<string, unknown>;
    return {
      id: String(thread.id ?? ""),
      title: String(thread.title ?? "Untitled"),
      description: thread.description ? String(thread.description) : undefined,
      updatedAt: thread.updatedAt ? new Date(String(thread.updatedAt)) : new Date(),
      status: (thread.status as ThreadItem["status"]) ?? "idle",
    };
  });
}

export function useEddaThreads(agentName?: string) {
  const url = agentName
    ? `/api/v1/threads?agent_name=${encodeURIComponent(agentName)}`
    : `/api/v1/threads`;

  const { data, error, isLoading, mutate } = useSWR<ThreadItem[]>(
    url,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 10_000,
      errorRetryCount: 3,
    },
  );

  return { threads: data ?? [], error, isLoading, mutate };
}
