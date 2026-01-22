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

// Start the server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  Deno.exit(1);
});
