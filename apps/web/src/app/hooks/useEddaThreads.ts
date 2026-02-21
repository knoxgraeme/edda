"use client";

import useSWR from "swr";
import type { ThreadItem } from "@/app/types/types";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8000";

async function fetcher(url: string): Promise<ThreadItem[]> {
  const response = await fetch(url);
  if (!response.ok) {
    // Handle 404 gracefully — server endpoint not yet implemented
    if (response.status === 404) {
      return [];
    }
    throw new Error(`Failed to fetch threads: ${response.status}`);
  }
  const data = (await response.json()) as unknown[];
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

export function useEddaThreads() {
  const { data, error, isLoading, mutate } = useSWR<ThreadItem[]>(
    `${SERVER_URL}/api/threads`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 10_000,
      errorRetryCount: 3,
    }
  );

  return { threads: data ?? [], error, isLoading, mutate };
}
