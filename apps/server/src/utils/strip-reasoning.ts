/**
 * Strip reasoning/thinking blocks from model output.
 *
 * Some models emit chain-of-thought in <think>...</think> or
 * <thinking>...</thinking> tags. This utility strips them in both
 * streaming (chunk-by-chunk) and non-streaming (full string) contexts.
 */

const OPEN_TAGS = ["<think>", "<thinking>"] as const;
const CLOSE_TAGS: Record<string, string> = {
  "<think>": "</think>",
  "<thinking>": "</thinking>",
};

/**
 * Streaming-safe reasoning block stripper.
 * Tracks whether we're inside a think/thinking block across chunk boundaries.
 * `activeCloseTag` tracks which closing tag to look for (set when an open tag is found).
 */
export function stripReasoningContent(
  content: string,
  insideThinkBlock: boolean,
  activeCloseTag?: string,
): { content: string; insideThinkBlock: boolean; activeCloseTag?: string } {
  let result = "";
  let inside = insideThinkBlock;
  let closeTag = activeCloseTag ?? "</think>";
  let i = 0;

  while (i < content.length) {
    if (inside) {
      const closeIdx = content.indexOf(closeTag, i);
      if (closeIdx === -1) {
        // Still inside, consume rest of chunk
        return { content: result, insideThinkBlock: true, activeCloseTag: closeTag };
      }
      i = closeIdx + closeTag.length;
      inside = false;
    } else {
      // Find the earliest open tag
      let earliestIdx = -1;
      let matchedOpen = "";
      for (const tag of OPEN_TAGS) {
        const idx = content.indexOf(tag, i);
        if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
          earliestIdx = idx;
          matchedOpen = tag;
        }
      }
      if (earliestIdx === -1) {
        result += content.slice(i);
        break;
      }
      result += content.slice(i, earliestIdx);
      i = earliestIdx + matchedOpen.length;
      inside = true;
      closeTag = CLOSE_TAGS[matchedOpen];
    }
  }

  return { content: result, insideThinkBlock: inside, activeCloseTag: inside ? closeTag : undefined };
}

/**
 * Strip all <think>...</think> and <thinking>...</thinking> blocks from a complete string.
 * For non-streaming contexts (e.g. extracting final assistant message).
 */
export function stripReasoningBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
    .trim();
}
