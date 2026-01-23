# MCP GitHub Actions

A Deno-based MCP (Model Context Protocol) service that helps you securely
reference GitHub Actions by providing:

- Latest version lookup for any GitHub Action
- Commit SHA retrieval for specific version tags
- Immutability status checking for releases
- Ready-to-use SHA-pinned references

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

## Tool: `lookup_action`

### Parameters

| Parameter              | Type    | Required | Description                                                          |
| ---------------------- | ------- | -------- | -------------------------------------------------------------------- |
| `action`               | string  | Yes      | Action reference (e.g., `actions/checkout` or `actions/checkout@v4`) |
| `include_all_versions` | boolean | No       | List all available versions (default: false)                         |

### Example Output

```
Action: actions/checkout

Latest Version: v4.2.2
  Commit SHA: 11bd71901bbe5b1630ceea73d27597364c9af683
  Immutable: Yes
  Published: 2024-10-23T14:05:06Z

Recommended Usage (SHA-pinned):
  uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

Security Notes:
  - This release is immutable - the tag and assets are protected from modification.
  - SHA-pinned references prevent supply chain attacks by ensuring you always use the exact same code.
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

Latest Version: v4.2.1
  Commit SHA: abc123...
  Immutable: Yes
  Published: 2024-10-15T10:00:00Z (7 days ago)

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
