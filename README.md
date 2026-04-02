<p align="center">
  <img src="apps/marketing/public/og-image.webp" alt="Plannotator" width="80%" />
</p>

# Plannotator

Interactive Plan & Code Review for AI Coding Agents. Mark up and refine your plans or code diffs using a visual UI, share for team collaboration, and seamlessly integrate with **Claude Code**, **Copilot CLI**, **Gemini CLI**, **OpenCode**, **Pi**, and **Codex**.

This fork adds **Plastic SCM (Unity DevOps Version Control)** support — the code review feature now works with both Git and Plastic SCM repositories. The system auto-detects the VCS via `.plastic`/`.git` directory presence and routes through the appropriate provider.


### Features

<table>
<tr><td><strong>Visual Plan Review</strong></td><td>Built-in hook</td><td>Approve or deny agent plans with inline annotations</td></tr>
<tr><td><strong>Plan Diff</strong></td><td>Automatic</td><td>See what changed when the agent revises a plan</td></tr>
<tr><td><strong>Code Review</strong></td><td><code>/plannotator-review</code></td><td>View git or Plastic SCM diffs, or remote PRs. Package annotations and ask AI about the code as you review.</td></tr>
<tr><td><strong>Annotate Any File</strong></td><td><code>/plannotator-annotate</code></td><td>Annotate any markdown file and send feedback to your agent</td></tr>
<tr><td><strong>Annotate Last Message</strong></td><td><code>/plannotator-last</code></td><td>Annotate the agent's last response and send structured feedback</td></tr>
<tr><td><strong>Plastic SCM Support</strong></td><td>Auto-detect</td><td>Full code review support for Plastic SCM (Unity DevOps) repos via <code>cm</code> CLI</td></tr>
</table>

#### Sharing Plans

Plannotator lets you privately share plans, annotations, and feedback with colleagues. For example, a colleague can annotate a shared plan, and you can import their feedback to send directly back to the coding agent.

**Small plans** are encoded entirely in the URL hash. No server involved, nothing stored anywhere.

**Large plans** use a short link service with **end-to-end encryption**. Your plan is encrypted with AES-256-GCM in your browser before upload. The server stores only ciphertext it cannot read. The decryption key lives only in the URL you share. Pastes auto-delete after 7 days.

- Zero-knowledge storage, similar to [PrivateBin](https://privatebin.info/)
- Fully open source and **self-hostable** ([see docs](https://plannotator.ai/docs/guides/sharing-and-collaboration/))

## Install

- [Claude Code](#install-for-claude-code)
- [Copilot CLI](#install-for-copilot-cli)
- [Gemini CLI](#install-for-gemini-cli)
- [OpenCode](#install-for-opencode)
- [Pi](#install-for-pi)
- [Codex](#install-for-codex)

### Fork: Build from Source

This fork adds Plastic SCM support. To build locally:

```bash
bun install
bun run --cwd apps/review build && bun run build:hook
```

**Compile to a single binary (optional):**

```bash
# macOS / Linux
bun build apps/hook/server/index.ts --compile --outfile ~/.local/bin/plannotator

# Windows
bun build apps/hook/server/index.ts --compile --outfile plannotator.exe
```

**Use with Claude Code:**

```
/plugin marketplace add backnotprop/plannotator
```

Restart Claude Code after plugin install.

<details>
<summary>Pin a specific version or verify provenance</summary>

```bash
curl -fsSL https://plannotator.ai/install.sh | bash -s -- --version vX.Y.Z
```

```powershell
& ([scriptblock]::Create((irm https://plannotator.ai/install.ps1))) -Version vX.Y.Z
```

Every released binary ships with a SHA256 sidecar (verified automatically). [SLSA provenance](https://slsa.dev/) verification is supported from v0.17.2 onwards — see the [installation docs](https://plannotator.ai/docs/getting-started/installation/#verifying-your-install) for details.

</details>

See [apps/hook/README.md](apps/hook/README.md) for detailed installation instructions including a `manual hook` approach.

---

## Plastic SCM (Unity DevOps) Support

This fork introduces a VCS abstraction layer so the code review feature works with both **Git** and **Plastic SCM** repositories.

- **Auto-detection**: The system checks for `.plastic` or `.git` directories and routes through the appropriate provider
- **`cm` CLI integration**: Uses the Plastic SCM `cm` command-line tool to compute pending changes and generate unified diffs
- **No staging UI**: Since Plastic SCM doesn't have a staging area like Git, the stage/unstage UI is automatically hidden
- **Browser heartbeat**: The review server auto-shuts down when the browser tab is closed (heartbeat-based lifecycle management)

**Requirements**: The `cm` CLI must be available in your PATH. This is included with the Unity DevOps Version Control (Plastic SCM) installation.

---

## Install for Claude Code

**Install the `plannotator` command:**

**macOS / Linux / WSL:**
```bash
curl -fsSL https://plannotator.ai/install.sh | bash
```

**Windows PowerShell:**

```powershell
irm https://plannotator.ai/install.ps1 | iex
```

**Then in Copilot CLI:**

```
/plugin marketplace add backnotprop/plannotator
/plugin install plannotator-copilot@plannotator
```

Restart Copilot CLI after plugin install. Plan review activates automatically when you use plan mode (`Shift+Tab` to enter plan mode).

See [apps/copilot/README.md](apps/copilot/README.md) for details.

---

## Install for Gemini CLI

**Install the `plannotator` command:**

**macOS / Linux / WSL:**

```bash
curl -fsSL https://plannotator.ai/install.sh | bash
```

**Windows PowerShell:**

```powershell
irm https://plannotator.ai/install.ps1 | iex
```

The installer auto-detects Gemini CLI (checks for `~/.gemini`) and configures the plan review hook and policy. It also installs `/plannotator-review` and `/plannotator-annotate` slash commands.

**Then in Gemini CLI:**

```
/plan                              # Enter plan mode — plans open in your browser
/plannotator-review                # Code review for current changes
/plannotator-review <pr-url>       # Review a GitHub pull request
/plannotator-annotate <file.md>    # Annotate a markdown file
```

Requires Gemini CLI 0.36.0 or later.

See [apps/gemini/README.md](apps/gemini/README.md) for details.

---

## Install for OpenCode

Add to your `opencode.json`:

```json
{
  "plugin": ["@plannotator/opencode@latest"]
}
```

**Run the install script** to get `/plannotator-review`:

```bash
curl -fsSL https://plannotator.ai/install.sh | bash
```

**Windows:**
```powershell
irm https://plannotator.ai/install.ps1 | iex
```

This also clears any cached plugin versions. Then restart OpenCode.

---

## Install for Pi

```bash
pi install npm:@plannotator/pi-extension
```

Then start Pi with `--plan` to enter plan mode, or toggle it during a session with `/plannotator`.

See [apps/pi-extension/README.md](apps/pi-extension/README.md) for full usage details, commands, and flags.

---

## Install for Codex

**Install the `plannotator` command:**

**macOS / Linux / WSL:**

```bash
curl -fsSL https://plannotator.ai/install.sh | bash
```

**Windows PowerShell:**

```powershell
irm https://plannotator.ai/install.ps1 | iex
```

**Then in Codex — feedback flows back into the agent loop automatically:**

```
!plannotator review           # Code review for current changes
!plannotator review <pr-url>  # Review a GitHub pull request
!plannotator annotate file.md # Annotate a markdown file
!plannotator last             # Annotate the last agent message
```

Plan mode is not yet supported.

See [apps/codex/README.md](apps/codex/README.md) for details.

---

## How It Works

When your AI agent finishes planning, Plannotator:

1. Opens the Plannotator UI in your browser
2. Lets you annotate the plan visually (delete, insert, replace, comment)
3. **Approve** → Agent proceeds with implementation
4. **Request changes** → Your annotations are sent back as structured feedback

(Similar flow for code review, except you can also comment on specific lines of code diffs)

---

## License

Copyright 2025-2026 backnotprop

This project is licensed under either of

- [Apache License, Version 2.0](LICENSE-APACHE) ([http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0))
- [MIT license](LICENSE-MIT) ([http://opensource.org/licenses/MIT](http://opensource.org/licenses/MIT))

at your option.

This fork is based on [backnotprop/plannotator](https://github.com/backnotprop/plannotator).
