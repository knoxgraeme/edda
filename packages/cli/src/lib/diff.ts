/**
 * Minimal line-level diff using a longest-common-subsequence backtrack.
 *
 * Not a replacement for `diff` / `jsdiff`. Intended only for showing
 * small AGENTS.md version deltas in the terminal, where files are
 * at most a few hundred lines. O(m*n) time and space.
 */

import chalk from "chalk";

export function lineDiff(before: string, after: string): string {
  const al = before.split("\n");
  const bl = after.split("\n");
  const m = al.length;
  const n = bl.length;

  // LCS table
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (al[i - 1] === bl[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack into unified lines
  const out: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (al[i - 1] === bl[j - 1]) {
      out.unshift(chalk.dim("  " + al[i - 1]));
      i--;
      j--;
    } else if (lcs[i - 1][j] >= lcs[i][j - 1]) {
      out.unshift(chalk.red("- " + al[i - 1]));
      i--;
    } else {
      out.unshift(chalk.green("+ " + bl[j - 1]));
      j--;
    }
  }
  while (i > 0) {
    out.unshift(chalk.red("- " + al[i - 1]));
    i--;
  }
  while (j > 0) {
    out.unshift(chalk.green("+ " + bl[j - 1]));
    j--;
  }

  return out.join("\n");
}
