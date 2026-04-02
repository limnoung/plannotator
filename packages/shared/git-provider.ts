/**
 * Git adapter – wraps the existing review-core.ts functions into the
 * VcsProvider interface.  This is a thin delegation layer; all real logic
 * lives in review-core.
 */

import {
  type ReviewGitRuntime,
  type DiffType,
  getGitContext,
  runGitDiff,
  runGitDiffWithContext,
  getFileContentsForDiff,
  gitAddFile,
  gitResetFile,
  validateFilePath,
} from "./review-core";
import type { VcsProvider, VcsContext, VcsDiffResult } from "./vcs-provider";

export function createGitProvider(runtime: ReviewGitRuntime): VcsProvider {
  return {
    type: "git",
    supportsStaging: true,

    async getContext(cwd?: string): Promise<VcsContext> {
      const gitCtx = await getGitContext(runtime, cwd);
      return {
        vcsType: "git",
        currentBranch: gitCtx.currentBranch,
        defaultBranch: gitCtx.defaultBranch,
        diffOptions: gitCtx.diffOptions,
        cwd: gitCtx.cwd,
        supportsStaging: true,
        worktrees: gitCtx.worktrees,
      };
    },

    async getDiff(
      diffType: string,
      defaultBranch: string,
      cwd?: string,
    ): Promise<VcsDiffResult> {
      return runGitDiff(runtime, diffType as DiffType, defaultBranch, cwd);
    },

    async getDiffWithContext(
      diffType: string,
      context: VcsContext,
    ): Promise<VcsDiffResult> {
      // Reconstruct GitContext for the core function
      const gitCtx = {
        currentBranch: context.currentBranch,
        defaultBranch: context.defaultBranch,
        diffOptions: context.diffOptions,
        worktrees: context.worktrees || [],
        cwd: context.cwd,
      };
      return runGitDiffWithContext(runtime, diffType as DiffType, gitCtx);
    },

    async getFileContents(
      diffType: string,
      defaultBranch: string,
      filePath: string,
      oldPath?: string,
      cwd?: string,
    ): Promise<{ oldContent: string | null; newContent: string | null }> {
      return getFileContentsForDiff(
        runtime,
        diffType as DiffType,
        defaultBranch,
        filePath,
        oldPath,
        cwd,
      );
    },

    async stageFile(filePath: string, cwd?: string): Promise<void> {
      return gitAddFile(runtime, filePath, cwd);
    },

    async unstageFile(filePath: string, cwd?: string): Promise<void> {
      return gitResetFile(runtime, filePath, cwd);
    },

    validateFilePath,
  };
}

// Re-export parseWorktreeDiffType since it's used by review.ts for worktree CWD extraction
export { parseWorktreeDiffType } from "./review-core";
