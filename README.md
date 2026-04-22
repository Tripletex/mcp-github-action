# MCP GitHub Actions

> ## ⚠️ This repository has moved
>
> Development has been transferred to
> **[Tripletex/mcp-dependency-version](https://github.com/Tripletex/mcp-dependency-version)**.
>
> This repository is **archived and no longer maintained**. Please update your
> references, issues, and pull requests to the new location. All future
> releases, fixes, and documentation will be published there.

---

A Deno-based MCP (Model Context Protocol) service that helps you securely
reference GitHub Actions by providing:

- Latest version lookup for any GitHub Action
- Commit SHA retrieval for specific version tags
- Immutability status checking for releases
- Ready-to-use SHA-pinned references
- **Workflow analysis** with update level detection (major/minor/patch)
- **Safe update suggestions** that avoid breaking changes
- **Documentation retrieval** for actions at specific versions
- **Version comparison** to identify changes and breaking updates between
  releases

## Why Use This?

GitHub Actions referenced by tag (e.g., `actions/checkout@v4`) can be vulnerable
to supply chain attacks if the tag is moved to point to malicious code. This MCP
service helps you:

1. **Find the commit SHA** for any action version
2. **Check if a release is immutable** (protected from modification)
3. **Get secure references** in the format `owner/repo@sha # version`

## Installation

### Prerequisites

- [Deno](https://deno.land/) 2.x or later

### Setup with Claude Desktop

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "github-actions": {
      "command": "deno",
      "args": [
        "run",
        "--allow-net",
        "--allow-env",
        "--allow-run=gh",
        "/path/to/mcp-github-actions/main.ts"
      ],
      "env": {
        "GITHUB_TOKEN": "your-github-token-optional"
      }
    }
  }
}
```

### Setup with Claude Code CLI

```bash
claude mcp add github-actions -- deno run --allow-net --allow-env --allow-run=gh /path/to/mcp-github-actions/main.ts
```

### Setup with Docker

The service is available as a Docker image using stdio transport.

**Pull the image:**

```bash
docker pull ghcr.io/tripletex/mcp-github-action:latest
```

**Run directly:**

```bash
docker run --rm -i -e GITHUB_TOKEN ghcr.io/tripletex/mcp-github-action:latest
```

**Claude Desktop configuration:**

```json
{
  "mcpServers": {
    "github-actions": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "-e",
        "GITHUB_TOKEN",
        "ghcr.io/tripletex/mcp-github-action:latest"
      ],
      "env": {
        "GITHUB_TOKEN": "your-github-token-optional"
      }
    }
  }
}
```

## Usage

Once configured, ask Claude to look up GitHub Actions:

**Example prompts:**

- "Look up the latest version of actions/checkout"
- "Get the secure reference for actions/setup-node@v4"
- "Check if actions/cache@v4.2.0 is immutable"
- "List all versions of actions/upload-artifact"
- "Analyze my workflow file for outdated actions"
- "Suggest safe updates for my CI workflow"
- "What's the latest v4.x version of actions/checkout?"
- "Show me the documentation for actions/checkout@v4"
- "Compare changes between actions/setup-node@v4.0.0 and v6.0.0"

## Tool: `lookup_action`

### Parameters

| Parameter              | Type    | Required | Description                                                          |
| ---------------------- | ------- | -------- | -------------------------------------------------------------------- |
| `action`               | string  | Yes      | Action reference (e.g., `actions/checkout` or `actions/checkout@v4`) |
| `include_all_versions` | boolean | No       | List all available versions (default: false)                         |

### Example Output

```
Action: actions/checkout

Latest Version: v6.0.1
  Commit SHA: 8e8c483db84b4bee98b60c0593521ed34d9990e8
  Immutable: No
  Published: 2025-12-02T16:38:59Z

Recommended Usage (SHA-pinned):
  uses: actions/checkout@8e8c483db84b4bee98b60c0593521ed34d9990e8 # v6.0.1

Security Notes:
  - WARNING: This release is NOT immutable. The tag could potentially be moved to a different commit.
  - Using the SHA-pinned reference provides protection against tag tampering.
  - SHA-pinned references prevent supply chain attacks by ensuring you always use the exact same code.
```

## Tool: `analyze_workflow`

Analyze a GitHub Actions workflow file and show version status for all actions.
Reports current vs latest versions, update levels (major/minor/patch), and risk
assessment.

### Parameters

| Parameter          | Type    | Required | Description                                          |
| ------------------ | ------- | -------- | ---------------------------------------------------- |
| `workflow_content` | string  | Yes      | The workflow YAML content to analyze                 |
| `only_updates`     | boolean | No       | Only show actions that need updates (default: false) |

### Example Output

```
## Summary
Total actions: 6
Up to date: 1
Major updates available: 2 ⚠️
Minor updates available: 2
Patch updates available: 1

## Actions

| Action | Current | Latest | Update | Risk |
|--------|---------|--------|--------|------|
| actions/checkout | v4.2.2 | v6.0.1 | ⚠️ Major | 🔴 High |
| actions/setup-node | v4.1.0 | v6.2.0 | ⚠️ Major | 🔴 High |
| docker/login-action | v3.3.0 | v3.6.0 | 📦 Minor | 🟡 Medium |
| docker/build-push-action | v6.9.0 | v6.18.0 | 📦 Minor | 🟡 Medium |
| appleboy/ssh-action | v1.2.0 | v1.2.4 | 🔧 Patch | 🟢 Low |

## Safe Updates (Minor/Patch)
...

## Major Updates (Review Required)
...
```

## Tool: `suggest_updates`

Suggest safe updates for GitHub Actions in a workflow. Returns only safe updates
(minor/patch) and suggestions to stay current within major versions.

### Parameters

| Parameter          | Type   | Required | Description                                                                  |
| ------------------ | ------ | -------- | ---------------------------------------------------------------------------- |
| `workflow_content` | string | Yes      | The workflow YAML content to analyze                                         |
| `risk_tolerance`   | string | No       | `"patch"` = only patches, `"minor"` = patch + minor (default), `"all"` = all |

### Example Output

```
## Summary
Total actions analyzed: 6
Already up to date: 1
Safe updates available: 3
Actions with major updates: 2 (staying on current major)

## Safe Updates
These updates are safe to apply:

### 📦 docker/login-action: v3.3.0 → v3.6.0
Minor version update - new features, backwards compatible

uses: docker/login-action@9780b0c442fbb1117ed29e0efdff1e18412f7567 # v3.6.0

### 🔧 appleboy/ssh-action: v1.2.0 → v1.2.4
Patch version update - bug fixes only

uses: appleboy/ssh-action@2ead5e36573714d0d3cfcbac3646c3e0f09ec849 # v1.2.4

## Updates Within Current Major
These actions have major updates available, but you can safely update within your current major version:

### actions/checkout: v4.2.2 → v4.2.2
Safe update within v4.x (latest overall is v6.0.1)

uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
```

## Tool: `get_latest_in_major`

Get the latest version of a GitHub Action within the same major version. Useful
for safe updates that avoid breaking changes.

### Parameters

| Parameter | Type   | Required | Description                                                              |
| --------- | ------ | -------- | ------------------------------------------------------------------------ |
| `action`  | string | Yes      | Action reference with version (e.g., `actions/checkout@v4` or `@v4.1.0`) |

### Example Output

```
Action: actions/checkout
Current Version: v4
Major Version: v4

Latest in v4.x: v4.2.2
  Commit SHA: 11bd71901bbe5b1630ceea73d27597364c9af683
  Immutable: Yes

Note: Latest overall is v6.0.1

Recommended Usage (SHA-pinned):
  uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
```

## Tool: `get_action_documentation`

Get README documentation for a GitHub Action at a specific version. Useful for
understanding how to use an action at a particular release.

### Parameters

| Parameter | Type   | Required | Description                                                                   |
| --------- | ------ | -------- | ----------------------------------------------------------------------------- |
| `action`  | string | Yes      | Action reference (e.g., `actions/checkout` or `actions/checkout@v4`)          |
| `ref`     | string | No       | Optional ref override (tag/branch/commit). Defaults to version or main branch |

### Example Output

```
# actions/checkout Documentation
Ref: v4.2.0

---

[Full README markdown content for the action at the specified version]
```

## Tool: `compare_action_versions`

Compare changes between two versions of a GitHub Action. Shows release notes and
identifies version update levels to help with upgrade decisions.

### Parameters

| Parameter        | Type   | Required | Description                                                   |
| ---------------- | ------ | -------- | ------------------------------------------------------------- |
| `action`         | string | Yes      | Action with current version (e.g., `actions/checkout@v4.0.2`) |
| `target_version` | string | No       | Target version (defaults to latest)                           |

### Example Output

```
# Version Comparison: actions/checkout

From: v4.0.0
To: v4.2.0

## Summary
- Total releases: 3
- Major updates: 0
- Minor updates: 2
- Patch updates: 1

## Release History (chronological)

### v4.1.0 (2025-02-15) - Minor Update
Added support for sparse checkouts and improved performance.

### v4.1.1 (2025-02-20) - Patch Update
Fixed bug with submodule handling on Windows.

### v4.2.0 (2025-03-01) - Minor Update
Added new input parameter for custom checkout paths.

---

Note: Major version updates (marked with ⚠️) may contain breaking changes.
Review the release notes above to understand the impact of each update.
```

## Authentication

The service supports multiple authentication methods, checked in the following
order:

1. **Org-specific tokens** (`GITHUB_TOKEN_<ORG>`) - For multi-org scenarios
2. **Environment variable** (`GITHUB_TOKEN`) - Explicit token configuration
3. **GitHub CLI** (`gh auth token`) - Automatic token from logged-in `gh` CLI
4. **Unauthenticated** - Public repositories only with rate limits

### Without Token (Unauthenticated)

- Works for public repositories only
- Rate limit: 60 requests/hour
- No setup required

### With GitHub CLI (Recommended for Development)

If you have the [GitHub CLI](https://cli.github.com/) installed and
authenticated:

```bash
gh auth login
```

The service will automatically use your `gh` CLI token when no explicit token is
configured. This is convenient for local development and doesn't require
managing separate tokens.

**Permissions note:** The service needs `--allow-run=gh` permission to execute
the `gh` command.

### With Environment Token

Set the `GITHUB_TOKEN` environment variable:

- Works for **private repositories**
- Rate limit: 5,000 requests/hour
- Required for organization private actions
- Recommended for production deployments

### Multi-Organization Support

For accessing private repositories across multiple organizations, configure
org-specific tokens:

```bash
# Org-specific tokens (format: GITHUB_TOKEN_<ORG_NAME>)
# Hyphens in org names become underscores, all uppercase
GITHUB_TOKEN_MY_ORG=ghp_xxx...            # For My-Org
GITHUB_TOKEN_OTHER_ORG=ghp_yyy...         # For Other-Org
GITHUB_TOKEN=ghp_zzz...                    # Fallback for public repos
```

**Token resolution order:**

1. Org-specific token (`GITHUB_TOKEN_<ORG>`)
2. Fallback token (`GITHUB_TOKEN`)
3. GitHub CLI token (`gh auth token`)
4. Unauthenticated (public repos only)

**Supported token types and required permissions:**

| Token Type       | Required Permissions                | Notes                                                    |
| ---------------- | ----------------------------------- | -------------------------------------------------------- |
| Fine-grained PAT | `Contents: Read` + `Metadata: Read` | Recommended - scoped to specific repos/orgs              |
| Classic PAT      | `repo` scope                        | Broader access - use only if fine-grained isn't suitable |
| GitHub App       | `Contents: Read`                    | Recommended for organizations                            |

> **Note:** For private repositories, the token must have read access to
> repository contents. Without proper permissions, you'll receive a 404 error
> when looking up private actions.

**Example Claude Desktop config with multi-org:**

```json
{
  "mcpServers": {
    "github-actions": {
      "command": "deno",
      "args": [
        "run",
        "--allow-net",
        "--allow-env",
        "--allow-run=gh",
        "/path/to/mcp-github-actions/main.ts"
      ],
      "env": {
        "GITHUB_TOKEN_MY_ORG": "ghs_xxx...",
        "GITHUB_TOKEN_OTHER_ORG": "ghs_yyy...",
        "GITHUB_TOKEN": "ghp_zzz..."
      }
    }
  }
}
```

## Configuration

### Minimum Release Age

To avoid using releases that are too new (which may contain undiscovered bugs or
be part of a supply chain attack), you can configure a minimum age requirement:

```bash
# Skip releases published within the last 5 days
MIN_RELEASE_AGE_DAYS=5
```

When set, the service will:

1. Skip the absolute latest release if it's newer than the threshold
2. Return the most recent release that meets the age requirement
3. Display the release age in the output
4. Add a note in security notes when filtering is active

**Example with minimum age:**

```
Action: actions/checkout

Latest Version: v6.0.1
  Commit SHA: 8e8c483db84b4bee98b60c0593521ed34d9990e8
  Immutable: No
  Published: 2025-12-02T16:38:59Z (52 days ago)

Security Notes:
  - Minimum release age filter active: only considering releases at least 5 days old.
```

If no release meets the age requirement, an error will be returned indicating
the latest release's age.

**Claude Desktop config with minimum age:**

```json
{
  "mcpServers": {
    "github-actions": {
      "command": "deno",
      "args": [
        "run",
        "--allow-net",
        "--allow-env",
        "--allow-run=gh",
        "/path/to/mcp-github-actions/main.ts"
      ],
      "env": {
        "GITHUB_TOKEN": "ghp_xxx...",
        "MIN_RELEASE_AGE_DAYS": "5"
      }
    }
  }
}
```

## Development

```bash
# Run the server
deno task start

# Run with watch mode (auto-reload)
deno task dev

# Type check
deno task check

# Lint
deno task lint

# Format
deno task fmt

# Compile to binary
deno task compile
```

## Security Best Practices

1. **Always use SHA-pinned references** in production workflows
2. **Check immutability status** - immutable releases cannot be modified
3. **Add version comments** for maintainability: `@sha # v4.2.0`
4. **Use Dependabot/Renovate** to keep SHA references updated

## References

- [GitHub Immutable Releases](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/immutable-releases)
- [Pinning GitHub Actions for Security](https://www.stepsecurity.io/blog/pinning-github-actions-for-enhanced-security-a-complete-guide)
- [Model Context Protocol](https://modelcontextprotocol.io/)

## License

MIT
