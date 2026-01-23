/**
 * Suggest safe updates for GitHub Actions in a workflow
 */

import { GitHubClient } from "../github/client.ts";
import {
  formatSecureActionReference,
  getUpdateLevel,
  matchesMajorVersion,
  parseVersion,
  type UpdateLevel,
} from "../utils/parse-action.ts";
import { parseWorkflow, type WorkflowAction } from "../utils/parse-workflow.ts";

/**
 * Update suggestion for an action
 */
export interface UpdateSuggestion {
  /** Action identifier (owner/repo) */
  action: string;
  /** Current version */
  currentVersion: string;
  /** Suggested version to update to */
  suggestedVersion: string;
  /** Commit SHA for the suggested version */
  suggestedSha: string;
  /** Type of update */
  updateLevel: UpdateLevel;
  /** Whether the suggested release is immutable */
  immutable: boolean;
  /** Ready-to-use secure reference */
  secureReference: string;
  /** Reason for the suggestion */
  reason: string;
}

/**
 * Result of suggest_updates tool
 */
export interface SuggestUpdatesResult {
  /** Workflow name if specified */
  workflowName?: string;
  /** Safe updates (minor/patch) */
  safeUpdates: UpdateSuggestion[];
  /** Updates within same major (for actions with major updates available) */
  majorToLatestInMajor: UpdateSuggestion[];
  /** Summary */
  summary: {
    totalActions: number;
    safeUpdatesCount: number;
    majorUpdatesAvailable: number;
    alreadyUpToDate: number;
  };
  /** Parsing errors */
  errors: string[];
}

/**
 * Input for suggest_updates tool
 */
export interface SuggestUpdatesInput {
  /** Workflow YAML content */
  workflow_content: string;
  /** Risk tolerance: "patch" = only patch, "minor" = patch + minor, "all" = include major */
  risk_tolerance?: "patch" | "minor" | "all";
}

/**
 * Get the latest release within a specific major version
 */
async function getLatestInMajor(
  client: GitHubClient,
  owner: string,
  repo: string,
  majorVersion: number,
): Promise<{ tag: string; sha: string; immutable: boolean } | null> {
  try {
    const releases = await client.listReleases(owner, repo);
    const matching = releases
      .filter((r) => !r.draft && !r.prerelease)
      .filter((r) => matchesMajorVersion(r.tag_name, majorVersion))
      .sort((a, b) => {
        const aVer = parseVersion(a.tag_name);
        const bVer = parseVersion(b.tag_name);
        if (aVer.minor !== bVer.minor) return bVer.minor - aVer.minor;
        return bVer.patch - aVer.patch;
      });

    if (matching.length === 0) return null;

    const release = matching[0];
    const sha = await client.getCommitShaForTag(owner, repo, release.tag_name);
    return {
      tag: release.tag_name,
      sha,
      immutable: release.immutable ?? false,
    };
  } catch {
    return null;
  }
}

/**
 * Analyze a single action and generate update suggestions
 */
async function analyzeActionForSuggestions(
  action: WorkflowAction,
): Promise<{
  safe?: UpdateSuggestion;
  majorToLatestInMajor?: UpdateSuggestion;
  upToDate: boolean;
  hasMajorUpdate: boolean;
  error?: string;
}> {
  const { owner, repo, version, isCommitSha } = action.parsed;
  const actionId = `${owner}/${repo}`;

  // Skip SHA-pinned references - we can't determine their version
  if (isCommitSha || !version) {
    return { upToDate: true, hasMajorUpdate: false };
  }

  const client = new GitHubClient(owner);

  try {
    const latestRelease = await client.getLatestRelease(owner, repo);
    const latestSha = await client.getCommitShaForTag(
      owner,
      repo,
      latestRelease.tag_name,
    );

    const updateLevel = getUpdateLevel(version, latestRelease.tag_name);

    if (updateLevel === "none") {
      return { upToDate: true, hasMajorUpdate: false };
    }

    // Safe update (minor or patch)
    if (updateLevel === "minor" || updateLevel === "patch") {
      return {
        safe: {
          action: actionId,
          currentVersion: version,
          suggestedVersion: latestRelease.tag_name,
          suggestedSha: latestSha,
          updateLevel,
          immutable: latestRelease.immutable ?? false,
          secureReference: formatSecureActionReference(
            owner,
            repo,
            latestSha,
            latestRelease.tag_name,
          ),
          reason: updateLevel === "minor"
            ? "Minor version update - new features, backwards compatible"
            : "Patch version update - bug fixes only",
        },
        upToDate: false,
        hasMajorUpdate: false,
      };
    }

    // Major update - suggest latest in current major instead
    if (updateLevel === "major") {
      const currentMajor = parseVersion(version).major;
      const latestInMajor = await getLatestInMajor(
        client,
        owner,
        repo,
        currentMajor,
      );

      if (latestInMajor && latestInMajor.tag !== version) {
        return {
          majorToLatestInMajor: {
            action: actionId,
            currentVersion: version,
            suggestedVersion: latestInMajor.tag,
            suggestedSha: latestInMajor.sha,
            updateLevel: getUpdateLevel(version, latestInMajor.tag),
            immutable: latestInMajor.immutable,
            secureReference: formatSecureActionReference(
              owner,
              repo,
              latestInMajor.sha,
              latestInMajor.tag,
            ),
            reason:
              `Safe update within v${currentMajor}.x (latest overall is ${latestRelease.tag_name})`,
          },
          upToDate: false,
          hasMajorUpdate: true,
        };
      }

      // Already at latest in major, just flag as having major update
      return { upToDate: true, hasMajorUpdate: true };
    }

    return { upToDate: true, hasMajorUpdate: false };
  } catch (error) {
    return {
      upToDate: false,
      hasMajorUpdate: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Suggest safe updates for a workflow
 */
export async function suggestUpdates(
  input: SuggestUpdatesInput,
): Promise<SuggestUpdatesResult> {
  const workflow = parseWorkflow(input.workflow_content);
  const riskTolerance = input.risk_tolerance || "minor";

  // Deduplicate actions
  const seen = new Set<string>();
  const uniqueActions: WorkflowAction[] = [];

  for (const action of workflow.actions) {
    const key = `${action.parsed.owner}/${action.parsed.repo}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueActions.push(action);
    }
  }

  // Analyze each action
  const results = await Promise.all(
    uniqueActions.map((action) => analyzeActionForSuggestions(action)),
  );

  // Collect suggestions based on risk tolerance
  const safeUpdates: UpdateSuggestion[] = [];
  const majorToLatestInMajor: UpdateSuggestion[] = [];
  let alreadyUpToDate = 0;
  let majorUpdatesAvailable = 0;

  for (const result of results) {
    if (result.error) continue;

    if (result.upToDate && !result.hasMajorUpdate) {
      alreadyUpToDate++;
    }

    if (result.hasMajorUpdate) {
      majorUpdatesAvailable++;
    }

    if (result.safe) {
      // Apply risk tolerance filter
      if (
        riskTolerance === "patch" &&
        result.safe.updateLevel !== "patch"
      ) {
        continue;
      }
      safeUpdates.push(result.safe);
    }

    if (result.majorToLatestInMajor) {
      majorToLatestInMajor.push(result.majorToLatestInMajor);
    }
  }

  return {
    workflowName: workflow.name,
    safeUpdates,
    majorToLatestInMajor,
    summary: {
      totalActions: uniqueActions.length,
      safeUpdatesCount: safeUpdates.length,
      majorUpdatesAvailable,
      alreadyUpToDate,
    },
    errors: workflow.errors,
  };
}

/**
 * Format suggest updates result as text
 */
export function formatSuggestUpdatesAsText(
  result: SuggestUpdatesResult,
): string {
  const lines: string[] = [];

  if (result.workflowName) {
    lines.push(`Workflow: ${result.workflowName}`);
    lines.push("");
  }

  // Summary
  lines.push("## Summary");
  lines.push(`Total actions analyzed: ${result.summary.totalActions}`);
  lines.push(`Already up to date: ${result.summary.alreadyUpToDate}`);
  lines.push(`Safe updates available: ${result.summary.safeUpdatesCount}`);
  if (result.summary.majorUpdatesAvailable > 0) {
    lines.push(
      `Actions with major updates: ${result.summary.majorUpdatesAvailable} (staying on current major)`,
    );
  }
  lines.push("");

  // Safe updates
  if (result.safeUpdates.length > 0) {
    lines.push("## Safe Updates");
    lines.push("These updates are safe to apply:");
    lines.push("");

    for (const update of result.safeUpdates) {
      const icon = update.updateLevel === "patch" ? "🔧" : "📦";
      lines.push(
        `### ${icon} ${update.action}: ${update.currentVersion} → ${update.suggestedVersion}`,
      );
      lines.push(`${update.reason}`);
      lines.push("");
      lines.push("```yaml");
      lines.push(`uses: ${update.secureReference}`);
      lines.push("```");
      lines.push("");
    }
  }

  // Major to latest in major
  if (result.majorToLatestInMajor.length > 0) {
    lines.push("## Updates Within Current Major");
    lines.push(
      "These actions have major updates available, but you can safely update within your current major version:",
    );
    lines.push("");

    for (const update of result.majorToLatestInMajor) {
      lines.push(
        `### ${update.action}: ${update.currentVersion} → ${update.suggestedVersion}`,
      );
      lines.push(`${update.reason}`);
      lines.push("");
      lines.push("```yaml");
      lines.push(`uses: ${update.secureReference}`);
      lines.push("```");
      lines.push("");
    }
  }

  if (
    result.safeUpdates.length === 0 &&
    result.majorToLatestInMajor.length === 0
  ) {
    lines.push("✅ All actions are up to date!");
  }

  return lines.join("\n");
}

/**
 * Input for get_latest_in_major tool
 */
export interface GetLatestInMajorInput {
  /** Action reference, e.g., 'actions/checkout@v4' */
  action: string;
}

/**
 * Result of get_latest_in_major tool
 */
export interface GetLatestInMajorResult {
  /** Action identifier */
  action: string;
  /** Current version specified */
  currentVersion: string;
  /** Major version */
  majorVersion: number;
  /** Latest version in the same major */
  latestInMajor: string | null;
  /** Commit SHA */
  latestInMajorSha: string | null;
  /** Whether immutable */
  immutable: boolean;
  /** Secure reference */
  secureReference: string | null;
  /** Latest overall version (for reference) */
  latestOverall: string | null;
  /** Error if any */
  error?: string;
}

/**
 * Get the latest version within the same major version
 */
export async function getLatestInMajorVersion(
  input: GetLatestInMajorInput,
): Promise<GetLatestInMajorResult> {
  // Import parseAction here to avoid circular dependency
  const { parseAction } = await import("../utils/parse-action.ts");
  const parsed = parseAction(input.action);
  const { owner, repo, version } = parsed;
  const actionId = `${owner}/${repo}`;

  if (!version) {
    return {
      action: actionId,
      currentVersion: "not specified",
      majorVersion: 0,
      latestInMajor: null,
      latestInMajorSha: null,
      immutable: false,
      secureReference: null,
      latestOverall: null,
      error: "No version specified in action reference",
    };
  }

  if (parsed.isCommitSha) {
    return {
      action: actionId,
      currentVersion: version.slice(0, 7),
      majorVersion: 0,
      latestInMajor: null,
      latestInMajorSha: null,
      immutable: false,
      secureReference: null,
      latestOverall: null,
      error: "Cannot determine major version from SHA reference",
    };
  }

  const currentMajor = parseVersion(version).major;
  const client = new GitHubClient(owner);

  try {
    // Get latest overall
    const latestRelease = await client.getLatestRelease(owner, repo);

    // Get latest in major
    const latestInMajor = await getLatestInMajor(
      client,
      owner,
      repo,
      currentMajor,
    );

    if (!latestInMajor) {
      return {
        action: actionId,
        currentVersion: version,
        majorVersion: currentMajor,
        latestInMajor: null,
        latestInMajorSha: null,
        immutable: false,
        secureReference: null,
        latestOverall: latestRelease.tag_name,
        error: `No releases found for major version ${currentMajor}`,
      };
    }

    return {
      action: actionId,
      currentVersion: version,
      majorVersion: currentMajor,
      latestInMajor: latestInMajor.tag,
      latestInMajorSha: latestInMajor.sha,
      immutable: latestInMajor.immutable,
      secureReference: formatSecureActionReference(
        owner,
        repo,
        latestInMajor.sha,
        latestInMajor.tag,
      ),
      latestOverall: latestRelease.tag_name,
    };
  } catch (error) {
    return {
      action: actionId,
      currentVersion: version,
      majorVersion: currentMajor,
      latestInMajor: null,
      latestInMajorSha: null,
      immutable: false,
      secureReference: null,
      latestOverall: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Format get_latest_in_major result as text
 */
export function formatLatestInMajorAsText(
  result: GetLatestInMajorResult,
): string {
  const lines: string[] = [];

  lines.push(`Action: ${result.action}`);
  lines.push(`Current Version: ${result.currentVersion}`);
  lines.push(`Major Version: v${result.majorVersion}`);
  lines.push("");

  if (result.error) {
    lines.push(`Error: ${result.error}`);
    return lines.join("\n");
  }

  if (result.latestInMajor) {
    lines.push(`Latest in v${result.majorVersion}.x: ${result.latestInMajor}`);
    lines.push(`  Commit SHA: ${result.latestInMajorSha}`);
    lines.push(`  Immutable: ${result.immutable ? "Yes" : "No"}`);
  }

  if (result.latestOverall && result.latestOverall !== result.latestInMajor) {
    lines.push("");
    lines.push(`Note: Latest overall is ${result.latestOverall}`);
  }

  if (result.secureReference) {
    lines.push("");
    lines.push("Recommended Usage (SHA-pinned):");
    lines.push(`  uses: ${result.secureReference}`);
  }

  return lines.join("\n");
}
