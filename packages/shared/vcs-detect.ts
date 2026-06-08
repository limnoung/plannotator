/**
 * Auto-detect which VCS is managing the given directory.
 *
 * Fork addition (Plastic SCM). Kept cm-free so detection stays fast and works
 * even when the `cm` CLI is not installed — both checks are pure filesystem.
 */

import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type VcsType = "git" | "plastic";

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function detectVcsType(cwd?: string): Promise<VcsType | null> {
  const dir = cwd || process.cwd();

  // Check for .plastic directory first (more specific)
  if (await isDirectory(join(dir, ".plastic"))) return "plastic";

  // Check for .git directory or file (worktrees use a .git file)
  try {
    const gitStat = await stat(join(dir, ".git"));
    if (gitStat.isDirectory() || gitStat.isFile()) return "git";
  } catch {
    // not a Git repo
  }

  return null;
}

/**
 * Walk up from `cwd` to find the Plastic workspace root — the nearest ancestor
 * directory that contains a `.plastic` folder. Returns null if none is found.
 *
 * Used as the VcsProvider.getRoot for Plastic so upstream's nearest-ancestor
 * provider selection (selectNearestProvider) ranks Plastic correctly without
 * shelling out to `cm`.
 */
export async function findPlasticRoot(cwd?: string): Promise<string | null> {
  let dir = resolve(cwd || process.cwd());

  while (true) {
    if (await isDirectory(join(dir, ".plastic"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
