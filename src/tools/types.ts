/**
 * Types for MCP tool inputs and outputs
 */

export interface LookupActionInput {
  /** Action reference, e.g., 'actions/checkout' or 'actions/checkout@v4' */
  action: string;
  /** List all available versions, default false */
  include_all_versions?: boolean;
}

export interface VersionInfo {
  tag: string;
  commitSha: string;
  immutable: boolean;
  publishedAt: string | null;
  isPrerelease: boolean;
}

export interface LookupActionResult {
  /** The action reference (owner/repo) */
  action: string;
  /** Latest version available */
  latestVersion: VersionInfo | null;
  /** Requested version info (if version was specified) */
  requestedVersion: VersionInfo | null;
  /** Whether requested version was resolved from a prefix (e.g., v4 -> v4.2.0) */
  resolvedFromPrefix: boolean;
  /** Ready-to-use secure action reference */
  secureReference: string;
  /** Security assessment notes */
  securityNotes: string[];
  /** All available versions (if include_all_versions is true) */
  allVersions?: VersionInfo[];
  /** Rate limit information */
  rateLimitRemaining?: number;
}
