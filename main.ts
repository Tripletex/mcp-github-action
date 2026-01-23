/**
 * MCP Server for GitHub Actions version lookup
 *
 * Provides secure GitHub Action references by looking up latest versions,
 * commit SHAs, and immutability status.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { formatResultAsText, lookupAction } from "./src/tools/lookup-action.ts";
import {
  analyzeWorkflow,
  formatAnalyzeResultAsText,
} from "./src/tools/analyze-workflow.ts";
import {
  formatLatestInMajorAsText,
  formatSuggestUpdatesAsText,
  getLatestInMajorVersion,
  suggestUpdates,
} from "./src/tools/suggest-updates.ts";

// Create the MCP server
const server = new McpServer({
  name: "github-actions",
  version: "1.0.0",
});

// Register the lookup_action tool
server.tool(
  "lookup_action",
  "Look up information about a GitHub Action and get secure SHA-pinned references. " +
    "Checks for immutable releases and provides security recommendations.",
  {
    action: z
      .string()
      .describe(
        "Action reference, e.g., 'actions/checkout' or 'actions/checkout@v4'",
      ),
    include_all_versions: z
      .boolean()
      .optional()
      .describe("List all available versions (default: false)"),
  },
  async ({ action, include_all_versions }) => {
    try {
      const result = await lookupAction({
        action,
        include_all_versions,
      });
      const text = formatResultAsText(result);

      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Unknown error occurred";
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Register the analyze_workflow tool
server.tool(
  "analyze_workflow",
  "Analyze a GitHub Actions workflow file and show version status for all actions. " +
    "Reports current vs latest versions, update levels (major/minor/patch), and risk assessment.",
  {
    workflow_content: z
      .string()
      .describe("The workflow YAML content to analyze"),
    only_updates: z
      .boolean()
      .optional()
      .describe("Only show actions that need updates (default: false)"),
  },
  async ({ workflow_content, only_updates }) => {
    try {
      const result = await analyzeWorkflow({
        workflow_content,
        only_updates,
      });
      const text = formatAnalyzeResultAsText(result);

      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Unknown error occurred";
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Register the suggest_updates tool
server.tool(
  "suggest_updates",
  "Suggest safe updates for GitHub Actions in a workflow. " +
    "Returns only safe updates (minor/patch) and suggestions to stay current within major versions.",
  {
    workflow_content: z
      .string()
      .describe("The workflow YAML content to analyze"),
    risk_tolerance: z
      .enum(["patch", "minor", "all"])
      .optional()
      .describe(
        "Risk tolerance: 'patch' = only patches, 'minor' = patch + minor (default), 'all' = include major",
      ),
  },
  async ({ workflow_content, risk_tolerance }) => {
    try {
      const result = await suggestUpdates({
        workflow_content,
        risk_tolerance,
      });
      const text = formatSuggestUpdatesAsText(result);

      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Unknown error occurred";
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Register the get_latest_in_major tool
server.tool(
  "get_latest_in_major",
  "Get the latest version of a GitHub Action within the same major version. " +
    "Useful for safe updates that avoid breaking changes.",
  {
    action: z
      .string()
      .describe(
        "Action reference with version, e.g., 'actions/checkout@v4' or 'actions/setup-node@v4.1.0'",
      ),
  },
  async ({ action }) => {
    try {
      const result = await getLatestInMajorVersion({ action });
      const text = formatLatestInMajorAsText(result);

      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Unknown error occurred";
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Start the server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  Deno.exit(1);
});
