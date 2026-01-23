/**
 * Analyze GitHub Actions workflow files for version updates
 */

import { GitHubClient } from "../github/client.ts";
import type { GitHubRelease } from "../github/types.ts";
import {
  formatSecureActionReference,
  getUpdateLevel,
  getUpdateRisk,
  matchesMajorVersion,
  parseVersion,
  type UpdateLevel,
} from "../utils/parse-action.ts";
import { parseWorkflow, type WorkflowAction } from "../utils/parse-workflow.ts";

/**
 * Information about a single action's version status
 */
export interface ActionVersionInfo {
  /** Action identifier (owner/repo) */
  action: string;
  /** Current version in use */
  currentVersion: string | null;
  /** Current commit SHA if using SHA-pinned reference */
  currentSha: string | null;
  /** Latest available version */
  latestVersion: string | null;
  /** Latest version within the same major */
  latestInMajor: string | null;
  /** Commit SHA for latest version */
  latestSha: string | null;
  /** Commit SHA for latest in major */
  latestInMajorSha: string | null;
  /** Type of update needed */
  updateLevel: UpdateLevel;
  /** Risk level for the update */
  risk: "high" | "medium" | "low" | "none";
  /** Whether the latest release is immutable */
  immutable: boolean;
  /** Secure reference for the recommended version */
  secureReference: string | null;
  /** Jobs/steps where this action is used */
  usedIn: { job?: string; step?: string; line?: number }[];
  /** Error message if lookup failed */
  error?: string;
}

/**
 * Result of analyzing a workflow
 */
export interface AnalyzeWorkflowResult {
  /** Workflow name if specified */
  workflowName?: string;
  /** All actions analyzed */
  actions: ActionVersionInfo[];
  /** Summary statistics */
  summary: {
    total: number;
    upToDate: number;
    majorUpdates: number;
    minorUpdates: number;
    patchUpdates: number;
    errors: number;
  };
  /** Parsing errors from the workflow */
  parsingErrors: string[];
}

/**
 * Input for analyze_workflow tool
 */
export interface AnalyzeWorkflowInput {
  /** Workflow YAML content */
  workflow_content: string;
  /** Only show actions that need updates */
  only_updates?: boolean;
  /** Include latest-in-major suggestions for major updates */
  include_safe_updates?: boolean;
}

/**
 * Get the latest release within a specific major version
 */
async function getLatestInMajor(
  client: GitHubClient,
  owner: string,
  repo: string,
  majorVersion: number,
): Promise<{ release: GitHubRelease; sha: string } | null> {
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
    return { release, sha };
  } catch {
    return null;
  }
}

/**
 * Analyze a single action's version status
 */
async function analyzeAction(
  action: WorkflowAction,
  allActions: WorkflowAction[],
): Promise<ActionVersionInfo> {
  const { owner, repo, version, isCommitSha } = action.parsed;
  const actionId = `${owner}/${repo}`;

  // Find all usages of this action
  const usedIn = allActions
    .filter((a) => a.parsed.owner === owner && a.parsed.repo === repo)
    .map((a) => ({ job: a.job, step: a.step, line: a.line }));

  const client = new GitHubClient(owner);

  try {
    // Get latest release
    const latestRelease = await client.getLatestRelease(owner, repo);
    const latestSha = await client.getCommitShaForTag(
      owner,
      repo,
      latestRelease.tag_name,
    );

    // Determine current version
    let currentVersion: string | null = version || null;
    let currentSha: string | null = null;

    if (isCommitSha && version) {
      currentSha = version;
      currentVersion = null; // We don't know the version for SHA references
    }

    // Calculate update level
    let updateLevel: UpdateLevel = "none";
    if (currentVersion) {
      updateLevel = getUpdateLevel(currentVersion, latestRelease.tag_name);
    } else if (currentSha && currentSha !== latestSha) {
      // SHA reference that doesn't match latest - mark as potentially outdated
      updateLevel = "major"; // Conservative - we don't know the actual version
    }

    // Get latest in major if there's a major update available
    let latestInMajor: string | null = null;
    let latestInMajorSha: string | null = null;

    if (updateLevel === "major" && currentVersion) {
      const currentMajor = parseVersion(currentVersion).major;
      const inMajor = await getLatestInMajor(client, owner, repo, currentMajor);
      if (inMajor) {
        latestInMajor = inMajor.release.tag_name;
        latestInMajorSha = inMajor.sha;
      }
    }

    // Determine which version to recommend
    const recommendedVersion = updateLevel === "major" && latestInMajor
      ? latestInMajor
      : latestRelease.tag_name;
    const recommendedSha = updateLevel === "major" && latestInMajorSha
      ? latestInMajorSha
      : latestSha;

    return {
      action: actionId,
      currentVersion,
      currentSha,
      latestVersion: latestRelease.tag_name,
      latestInMajor,
      latestSha,
      latestInMajorSha,
      updateLevel,
      risk: getUpdateRisk(updateLevel),
      immutable: latestRelease.immutable ?? false,
      secureReference: formatSecureActionReference(
        owner,
        repo,
        recommendedSha,
        recommendedVersion,
      ),
      usedIn,
    };
  } catch (error) {
    return {
      action: actionId,
      currentVersion: version || null,
      currentSha: isCommitSha && version ? version : null,
      latestVersion: null,
      latestInMajor: null,
      latestSha: null,
      latestInMajorSha: null,
      updateLevel: "none",
      risk: "none",
      immutable: false,
      secureReference: null,
      usedIn,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Analyze a workflow and return version information for all actions
 */
export async function analyzeWorkflow(
  input: AnalyzeWorkflowInput,
): Promise<AnalyzeWorkflowResult> {
  const workflow = parseWorkflow(input.workflow_content);

  // Deduplicate actions by owner/repo
  const seen = new Set<string>();
  const uniqueActions: WorkflowAction[] = [];

  for (const action of workflow.actions) {
    const key = `${action.parsed.owner}/${action.parsed.repo}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueActions.push(action);
    }
  }

  // Analyze each unique action
  const results = await Promise.all(
    uniqueActions.map((action) => analyzeAction(action, workflow.actions)),
  );

  // Filter if only_updates is specified
  let actions = results;
  if (input.only_updates) {
    actions = results.filter((a) => a.updateLevel !== "none" || a.error);
  }

  // Calculate summary
  const summary = {
    total: results.length,
    upToDate: results.filter((a) => a.updateLevel === "none" && !a.error)
      .length,
    majorUpdates: results.filter((a) => a.updateLevel === "major").length,
    minorUpdates: results.filter((a) => a.updateLevel === "minor").length,
    patchUpdates: results.filter((a) => a.updateLevel === "patch").length,
    errors: results.filter((a) => a.error).length,
  };

  return {
    workflowName: workflow.name,
    actions,
    summary,
    parsingErrors: workflow.errors,
  };
}

/**
 * Format analyze workflow result as text
 */
export function formatAnalyzeResultAsText(
  result: AnalyzeWorkflowResult,
): string {
  const lines: string[] = [];

  if (result.workflowName) {
    lines.push(`Workflow: ${result.workflowName}`);
    lines.push("");
  }

  // Summary
  lines.push("## Summary");
  lines.push(`Total actions: ${result.summary.total}`);
  lines.push(`Up to date: ${result.summary.upToDate}`);
  if (result.summary.majorUpdates > 0) {
    lines.push(`Major updates available: ${result.summary.majorUpdates} ⚠️`);
  }
  if (result.summary.minorUpdates > 0) {
    lines.push(`Minor updates available: ${result.summary.minorUpdates}`);
  }
  if (result.summary.patchUpdates > 0) {
    lines.push(`Patch updates available: ${result.summary.patchUpdates}`);
  }
  if (result.summary.errors > 0) {
    lines.push(`Errors: ${result.summary.errors}`);
  }
  lines.push("");

  // Action table
  lines.push("## Actions");
  lines.push("");
  lines.push(
    "| Action | Current | Latest | Update | Risk |",
  );
  lines.push("|--------|---------|--------|--------|------|");

  for (const action of result.actions) {
    const current = action.currentVersion || action.currentSha?.slice(0, 7) ||
      "?";
    const latest = action.latestVersion || "?";
    const updateIcon = action.updateLevel === "major"
      ? "⚠️ Major"
      : action.updateLevel === "minor"
      ? "📦 Minor"
      : action.updateLevel === "patch"
      ? "🔧 Patch"
      : action.error
      ? "❌ Error"
      : "✅ Current";
    const risk = action.risk === "high"
      ? "🔴 High"
      : action.risk === "medium"
      ? "🟡 Medium"
      : action.risk === "low"
      ? "🟢 Low"
      : "—";

    lines.push(
      `| ${action.action} | ${current} | ${latest} | ${updateIcon} | ${risk} |`,
    );
  }

  // Safe updates section
  const safeUpdates = result.actions.filter(
    (a) => a.updateLevel === "minor" || a.updateLevel === "patch",
  );
  if (safeUpdates.length > 0) {
    lines.push("");
    lines.push("## Safe Updates (Minor/Patch)");
    lines.push(
      "These updates are generally safe and unlikely to break your workflow:",
    );
    lines.push("");
    for (const action of safeUpdates) {
      if (action.secureReference) {
        lines.push(`\`\`\`yaml`);
        lines.push(`uses: ${action.secureReference}`);
        lines.push(`\`\`\``);
      }
    }
  }

  // Major updates with safe alternatives
  const majorUpdates = result.actions.filter((a) => a.updateLevel === "major");
  if (majorUpdates.length > 0) {
    lines.push("");
    lines.push("## Major Updates (Review Required)");
    lines.push(
      "These updates may contain breaking changes. Consider staying on current major:",
    );
    lines.push("");
    for (const action of majorUpdates) {
      lines.push(`### ${action.action}`);
      lines.push(`Current: ${action.currentVersion}`);
      lines.push(`Latest: ${action.latestVersion}`);
      if (action.latestInMajor) {
        lines.push(
          `Latest in current major: ${action.latestInMajor} (safe update)`,
        );
        if (action.latestInMajorSha) {
          lines.push("");
          lines.push("Safe update (stay on current major):");
          lines.push(`\`\`\`yaml`);
          lines.push(
            `uses: ${
              formatSecureActionReference(
                action.action.split("/")[0],
                action.action.split("/")[1],
                action.latestInMajorSha,
                action.latestInMajor,
              )
            }`,
          );
          lines.push(`\`\`\``);
        }
      }
      lines.push("");
    }
  }

  // Errors
  if (result.parsingErrors.length > 0) {
    lines.push("");
    lines.push("## Parsing Errors");
    for (const error of result.parsingErrors) {
      lines.push(`- ${error}`);
    }
  }

  return lines.join("\n");
}
