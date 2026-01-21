/**
 * Parse GitHub Action references into their components
 */

export interface ParsedAction {
  owner: string;
  repo: string;
  version?: string;
  isCommitSha: boolean;
}

// Regex to match GitHub Action references
// Formats: owner/repo, owner/repo@version, owner/repo@sha
const ACTION_REGEX = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(?:@(.+))?$/;

// SHA-1 hash is 40 hex characters
const SHA_REGEX = /^[a-f0-9]{40}$/i;

/**
 * Parse an action reference string into its components
 *
 * Examples:
 * - "actions/checkout" -> { owner: "actions", repo: "checkout" }
 * - "actions/checkout@v4" -> { owner: "actions", repo: "checkout", version: "v4" }
 * - "actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332" -> { ..., isCommitSha: true }
 */
export function parseAction(action: string): ParsedAction {
  const trimmed = action.trim();
  const match = trimmed.match(ACTION_REGEX);

  if (!match) {
    throw new Error(
      `Invalid action reference: "${action}". ` +
        `Expected format: owner/repo or owner/repo@version`
    );
  }

  const [, owner, repo, version] = match;

  return {
    owner,
    repo,
    version: version || undefined,
    isCommitSha: version ? SHA_REGEX.test(version) : false,
  };
}

/**
 * Format an action reference with a commit SHA and version comment
 *
 * Example output: "actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.2.0"
 */
export function formatSecureActionReference(
  owner: string,
  repo: string,
  commitSha: string,
  version: string
): string {
  return `${owner}/${repo}@${commitSha} # ${version}`;
}

/**
 * Check if a version string looks like a semantic version
 */
export function isSemverLike(version: string): boolean {
  // Matches v1, v1.0, v1.0.0, 1.0.0, etc.
  return /^v?\d+(\.\d+)*$/.test(version);
}

/**
 * Check if a version is a major version only (e.g., "v4" or "4")
 */
export function isMajorVersionOnly(version: string): boolean {
  return /^v?\d+$/.test(version);
}
