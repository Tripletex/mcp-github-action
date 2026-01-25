/**
 * Implementation of the get_action_documentation tool
 */

import { GitHubClient } from "../github/client.ts";
import { parseAction } from "../utils/parse-action.ts";

export interface GetActionDocumentationInput {
  action: string; // "actions/checkout" or "actions/checkout@v4"
  ref?: string; // Optional override (tag/branch/commit)
}

export interface GetActionDocumentationResult {
  action: string;
  ref: string; // Actual ref used
  content: string; // README markdown
  error?: string;
}

/**
 * Format the result as a human-readable string for the MCP response
 */
export function formatDocumentationResultAsText(
  result: GetActionDocumentationResult,
): string {
  if (result.error) {
    return `Error: ${result.error}`;
  }

  const lines: string[] = [];

  lines.push(`# ${result.action} Documentation`);
  lines.push(`Ref: ${result.ref}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(result.content);

  return lines.join("\n");
}

/**
 * Get README documentation for a GitHub Action at a specific version
 */
export async function getActionDocumentation(
  input: GetActionDocumentationInput,
): Promise<GetActionDocumentationResult> {
  try {
    const parsed = parseAction(input.action);
    const client = new GitHubClient(parsed.owner);

    // Determine which ref to use
    let ref: string;

    if (input.ref) {
      // Explicit ref override provided
      ref = input.ref;
    } else if (parsed.version) {
      // Use version from action string
      ref = parsed.version;
    } else {
      // Get the default branch from the repository
      ref = await client.getDefaultBranch(parsed.owner, parsed.repo);
    }

    // Fetch README.md at the determined ref
    const content = await client.getFileContent(
      parsed.owner,
      parsed.repo,
      "README.md",
      ref,
    );

    return {
      action: `${parsed.owner}/${parsed.repo}`,
      ref,
      content,
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unknown error occurred";

    return {
      action: input.action,
      ref: input.ref || "unknown",
      content: "",
      error: message,
    };
  }
}
