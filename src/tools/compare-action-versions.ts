/**
 * Implementation of the compare_action_versions tool
 */

import { GitHubClient } from "../github/client.ts";
import {
  getUpdateLevel,
  parseAction,
  parseVersion,
} from "../utils/parse-action.ts";

export interface CompareActionVersionsInput {
  action: string; // Must include version: "actions/checkout@v4.0.2"
  target_version?: string; // Optional, defaults to latest
}

export interface VersionChange {
  tag: string;
  published_at: string | null;
  body: string | null; // Release notes
  is_prerelease: boolean;
  version_type: "major" | "minor" | "patch" | "unknown"; // Type of version change from previous
}

export interface CompareActionVersionsResult {
  action: string;
  from_version: string;
  to_version: string;
  changes: VersionChange[];
  summary: {
    total_releases: number;
    major_updates: number;
    minor_updates: number;
    patch_updates: number;
  };
  error?: string;
}

/**
 * Format the result as a human-readable string for the MCP response
 */
export function formatCompareResultAsText(
  result: CompareActionVersionsResult,
): string {
  if (result.error) {
    return `Error: ${result.error}`;
  }

  const lines: string[] = [];

  lines.push(`# Version Comparison: ${result.action}`);
  lines.push("");
  lines.push(`From: ${result.from_version}`);
  lines.push(`To: ${result.to_version}`);
  lines.push("");

  // Summary section
  lines.push("## Summary");
  lines.push(`- Total releases: ${result.summary.total_releases}`);
  lines.push(`- Major updates: ${result.summary.major_updates}`);
  lines.push(`- Minor updates: ${result.summary.minor_updates}`);
  lines.push(`- Patch updates: ${result.summary.patch_updates}`);
  lines.push("");

  // Release history section
  if (result.changes.length > 0) {
    lines.push("## Release History (chronological)");
    lines.push("");

    for (const change of result.changes) {
      const warningFlag = change.version_type === "major" ? " ⚠️" : "";
      const versionTypeLabel = change.version_type.charAt(0).toUpperCase() +
        change.version_type.slice(1);
      const dateStr = change.published_at
        ? new Date(change.published_at).toISOString().split("T")[0]
        : "Unknown";

      lines.push(
        `### ${change.tag} (${dateStr}) - ${versionTypeLabel} Update${warningFlag}`,
      );

      if (change.body) {
        lines.push(change.body.trim());
      } else {
        lines.push("(No release notes provided)");
      }

      lines.push("");
    }

    lines.push("---");
    lines.push("");
    lines.push(
      "Note: Major version updates (marked with ⚠️) may contain breaking changes.",
    );
    lines.push(
      "Review the release notes above to understand the impact of each update.",
    );
  } else {
    lines.push("No releases found in the specified range.");
  }

  return lines.join("\n");
}

/**
 * Compare semantic versions to determine sort order
 * Returns: -1 if a < b, 1 if a > b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);

  if (parsedA.major !== parsedB.major) {
    return parsedA.major - parsedB.major;
  }
  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor - parsedB.minor;
  }
  if (parsedA.patch !== parsedB.patch) {
    return parsedA.patch - parsedB.patch;
  }

  return 0;
}

/**
 * Check if version is within range (inclusive)
 */
function isVersionInRange(
  version: string,
  from: string,
  to: string,
): boolean {
  return compareVersions(version, from) >= 0 &&
    compareVersions(version, to) <= 0;
}

/**
 * Compare changes between two versions of a GitHub Action
 */
export async function compareActionVersions(
  input: CompareActionVersionsInput,
): Promise<CompareActionVersionsResult> {
  try {
    const parsed = parseAction(input.action);

    // Require version in action string
    if (!parsed.version || parsed.isCommitSha) {
      return {
        action: `${parsed.owner}/${parsed.repo}`,
        from_version: "",
        to_version: "",
        changes: [],
        summary: {
          total_releases: 0,
          major_updates: 0,
          minor_updates: 0,
          patch_updates: 0,
        },
        error:
          "Action must include a version tag (e.g., 'actions/checkout@v4.0.2'). Commit SHAs are not supported.",
      };
    }

    const client = new GitHubClient(parsed.owner);
    const fromVersion = parsed.version;

    // Get target version (default to latest)
    let toVersion: string;
    if (input.target_version) {
      toVersion = input.target_version;
    } else {
      const latestRelease = await client.getLatestRelease(
        parsed.owner,
        parsed.repo,
      );
      toVersion = latestRelease.tag_name;
    }

    // Ensure from <= to (swap if needed)
    if (compareVersions(fromVersion, toVersion) > 0) {
      [toVersion] = [fromVersion];
      // Note: We keep fromVersion as the user provided it for error clarity
    }

    // Fetch all releases
    const allReleases = await client.listReleases(parsed.owner, parsed.repo);

    // Filter releases in range and exclude drafts
    const releasesInRange = allReleases.filter(
      (r) =>
        !r.draft &&
        isVersionInRange(r.tag_name, fromVersion, toVersion),
    );

    // Sort chronologically (oldest first)
    const sortedReleases = releasesInRange.sort((a, b) => {
      const dateA = a.published_at ? new Date(a.published_at).getTime() : 0;
      const dateB = b.published_at ? new Date(b.published_at).getTime() : 0;
      return dateA - dateB;
    });

    // Build version changes with type classification
    const changes: VersionChange[] = [];
    let majorCount = 0;
    let minorCount = 0;
    let patchCount = 0;

    for (let i = 0; i < sortedReleases.length; i++) {
      const release = sortedReleases[i];
      let versionType: "major" | "minor" | "patch" | "unknown" = "unknown";

      // Determine version type by comparing with previous release
      if (i > 0) {
        const prevRelease = sortedReleases[i - 1];
        const updateLevel = getUpdateLevel(
          prevRelease.tag_name,
          release.tag_name,
        );

        if (updateLevel === "major") {
          versionType = "major";
          majorCount++;
        } else if (updateLevel === "minor") {
          versionType = "minor";
          minorCount++;
        } else if (updateLevel === "patch") {
          versionType = "patch";
          patchCount++;
        }
      } else {
        // First release in range - determine type from fromVersion
        const updateLevel = getUpdateLevel(fromVersion, release.tag_name);
        if (updateLevel === "major") {
          versionType = "major";
          majorCount++;
        } else if (updateLevel === "minor") {
          versionType = "minor";
          minorCount++;
        } else if (updateLevel === "patch") {
          versionType = "patch";
          patchCount++;
        }
      }

      changes.push({
        tag: release.tag_name,
        published_at: release.published_at,
        body: release.body || null,
        is_prerelease: release.prerelease,
        version_type: versionType,
      });
    }

    return {
      action: `${parsed.owner}/${parsed.repo}`,
      from_version: fromVersion,
      to_version: toVersion,
      changes,
      summary: {
        total_releases: changes.length,
        major_updates: majorCount,
        minor_updates: minorCount,
        patch_updates: patchCount,
      },
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unknown error occurred";

    return {
      action: input.action,
      from_version: "",
      to_version: "",
      changes: [],
      summary: {
        total_releases: 0,
        major_updates: 0,
        minor_updates: 0,
        patch_updates: 0,
      },
      error: message,
    };
  }
}
