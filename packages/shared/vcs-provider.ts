/**
 * VCS Provider interface – abstracts version control operations so the review
 * feature can work with Git, Plastic SCM, or any future VCS backend.
 */

export type VcsType = "git" | "plastic";

export interface VcsDiffOption {
  id: string;
  label: string;
}

export interface VcsContext {
  vcsType: VcsType;
  currentBranch: string;
  defaultBranch: string;
  diffOptions: VcsDiffOption[];
  cwd?: string;
  supportsStaging: boolean;
  // worktrees only for git
  worktrees?: Array<{ path: string; branch: string | null; head: string }>;
}

export interface VcsDiffResult {
  patch: string;
  label: string;
  error?: string;
}

export interface VcsProvider {
  readonly type: VcsType;
  readonly supportsStaging: boolean;

  getContext(cwd?: string): Promise<VcsContext>;
  getDiff(
    diffType: string,
    defaultBranch: string,
    cwd?: string,
  ): Promise<VcsDiffResult>;
  getDiffWithContext(
    diffType: string,
    context: VcsContext,
  ): Promise<VcsDiffResult>;
  getFileContents(
    diffType: string,
    defaultBranch: string,
    filePath: string,
    oldPath?: string,
    cwd?: string,
  ): Promise<{ oldContent: string | null; newContent: string | null }>;
  stageFile(filePath: string, cwd?: string): Promise<void>;
  unstageFile(filePath: string, cwd?: string): Promise<void>;
  validateFilePath(filePath: string): void;
}
