/**
 * Auto-detect which VCS is managing the given directory.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { VcsType } from "./vcs-provider";

export async function detectVcsType(cwd?: string): Promise<VcsType | null> {
  const dir = cwd || process.cwd();

  // Check for .plastic directory first (more specific)
  try {
    const plasticStat = await stat(join(dir, ".plastic"));
    if (plasticStat.isDirectory()) return "plastic";
  } catch {
    // not a Plastic SCM repo – continue
  }

  // Check for .git directory or file (worktrees use a .git file)
  try {
    const gitStat = await stat(join(dir, ".git"));
    if (gitStat.isDirectory() || gitStat.isFile()) return "git";
  } catch {
    // not a Git repo
  }

  return null;
}
