/**
 * Strip reasoning/thinking blocks from model output.
 *
 * Some models (Minimax, DeepSeek R1) emit chain-of-thought in <think>...</think>
 * tags. This utility strips them in both streaming (chunk-by-chunk) and
 * non-streaming (full string) contexts.
 */

/**
 * Streaming-safe reasoning block stripper.
 * Tracks whether we're inside a <think> block across chunk boundaries.
 */
export function stripReasoningContent(
  content: string,
  insideThinkBlock: boolean,
): { content: string; insideThinkBlock: boolean } {
  let result = "";
  let inside = insideThinkBlock;
  let i = 0;

  while (i < content.length) {
    if (inside) {
      const closeIdx = content.indexOf("</think>", i);
      if (closeIdx === -1) {
        // Still inside, consume rest of chunk
        return { content: result, insideThinkBlock: true };
      }
      i = closeIdx + "</think>".length;
      inside = false;
    } else {
      const openIdx = content.indexOf("<think>", i);
      if (openIdx === -1) {
        result += content.slice(i);
        break;
      }
      result += content.slice(i, openIdx);
      i = openIdx + "<think>".length;
      inside = true;
    }
  }

  return { content: result, insideThinkBlock: inside };
}

/**
 * Strip all <think>...</think> blocks from a complete string.
 * For non-streaming contexts (e.g. extracting final assistant message).
 */
export function stripReasoningBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
