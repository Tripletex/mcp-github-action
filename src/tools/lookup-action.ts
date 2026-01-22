/**
 * Implementation of the lookup_action tool
 */

import { GitHubClient } from "../github/client.ts";
import { configResolver } from "../github/config.ts";
import type { GitHubRelease } from "../github/types.ts";
import {
  formatSecureActionReference,
  isMajorVersionOnly,
  parseAction,
} from "../utils/parse-action.ts";
import type {
  LookupActionInput,
  LookupActionResult,
  VersionInfo,
} from "./types.ts";

/**
 * Convert a GitHub release to VersionInfo
 */
async function releaseToVersionInfo(
  client: GitHubClient,
  owner: string,
  repo: string,
  release: GitHubRelease,
): Promise<VersionInfo> {
  const commitSha = await client.getCommitShaForTag(
    owner,
    repo,
    release.tag_name,
  );

  return {
    tag: release.tag_name,
    commitSha,
    immutable: release.immutable ?? false,
    publishedAt: release.published_at,
    isPrerelease: release.prerelease,
  };
}

/**
 * Generate security notes based on the action analysis
 */
function generateSecurityNotes(
  versionInfo: VersionInfo,
  resolvedFromPrefix: boolean,
  requestedVersion?: string,
): string[] {
  const notes: string[] = [];

  if (versionInfo.immutable) {
    notes.push(
      "This release is immutable - the tag and assets are protected from modification.",
    );
  } else {
    notes.push(
      "WARNING: This release is NOT immutable. The tag could potentially be moved to a different commit.",
    );
    notes.push(
      "Using the SHA-pinned reference provides protection against tag tampering.",
    );
  }

  if (resolvedFromPrefix && requestedVersion) {
    notes.push(
      `Version "${requestedVersion}" was resolved to "${versionInfo.tag}". ` +
        `Consider pinning to the specific version for reproducibility.`,
    );
  }

  // Add note about minimum release age filtering if enabled
  const minAgeDays = configResolver.getMinReleaseAgeDays();
  if (minAgeDays > 0) {
    notes.push(
      `Minimum release age filter active: only considering releases at least ${minAgeDays} days old.`,
    );
  }

  notes.push(
    "SHA-pinned references prevent supply chain attacks by ensuring you always use the exact same code.",
  );

  return notes;
}

/**
 * Get the age of a release in days
 */
function getReleaseAgeDays(publishedAt: string | null): number | null {
  if (!publishedAt) {
    return null;
  }
  const publishedDate = new Date(publishedAt);
  const now = new Date();
  return (now.getTime() - publishedDate.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Format age in days to a human-readable string
 */
function formatAge(ageDays: number): string {
  if (ageDays < 1) {
    const hours = Math.round(ageDays * 24);
    return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  } else {
    const days = Math.round(ageDays);
    return `${days} day${days !== 1 ? "s" : ""} ago`;
  }
}

/**
 * Format the result as a human-readable string for the MCP response
 */
export function formatResultAsText(result: LookupActionResult): string {
  const lines: string[] = [];

  lines.push(`Action: ${result.action}`);
  lines.push("");

  if (result.latestVersion) {
    lines.push(`Latest Version: ${result.latestVersion.tag}`);
    lines.push(`  Commit SHA: ${result.latestVersion.commitSha}`);
    lines.push(`  Immutable: ${result.latestVersion.immutable ? "Yes" : "No"}`);
    if (result.latestVersion.publishedAt) {
      const ageDays = getReleaseAgeDays(result.latestVersion.publishedAt);
      const ageStr = ageDays !== null ? ` (${formatAge(ageDays)})` : "";
      lines.push(`  Published: ${result.latestVersion.publishedAt}${ageStr}`);
    }
  }

  if (
    result.requestedVersion && result.requestedVersion !== result.latestVersion
  ) {
    lines.push("");
    lines.push(`Requested Version: ${result.requestedVersion.tag}`);
    if (result.resolvedFromPrefix) {
      lines.push(`  (resolved from version prefix)`);
    }
    lines.push(`  Commit SHA: ${result.requestedVersion.commitSha}`);
    lines.push(
      `  Immutable: ${result.requestedVersion.immutable ? "Yes" : "No"}`,
    );
  }

  lines.push("");
  lines.push("Recommended Usage (SHA-pinned):");
  lines.push(`  uses: ${result.secureReference}`);

  lines.push("");
  lines.push("Security Notes:");
  for (const note of result.securityNotes) {
    lines.push(`  - ${note}`);
  }

  if (result.allVersions && result.allVersions.length > 0) {
    lines.push("");
    lines.push("Available Versions:");
    for (const version of result.allVersions.slice(0, 10)) {
      const immutableTag = version.immutable ? " [immutable]" : "";
      lines.push(`  - ${version.tag}${immutableTag}`);
    }
    if (result.allVersions.length > 10) {
      lines.push(`  ... and ${result.allVersions.length - 10} more`);
    }
  }

  if (result.rateLimitRemaining !== undefined) {
    lines.push("");
    lines.push(`Rate Limit Remaining: ${result.rateLimitRemaining}`);
  }

  return lines.join("\n");
}

/**
 * Look up information about a GitHub Action
 */
export async function lookupAction(
  input: LookupActionInput,
): Promise<LookupActionResult> {
  const parsed = parseAction(input.action);
  // Create client with org context for token resolution
  const client = new GitHubClient(parsed.owner);

  // If already using a commit SHA, just return info about it
  if (parsed.isCommitSha) {
    return {
      action: `${parsed.owner}/${parsed.repo}`,
      latestVersion: null,
      requestedVersion: {
        tag: "commit SHA",
        commitSha: parsed.version!,
        immutable: true, // Commit SHAs are inherently immutable
        publishedAt: null,
        isPrerelease: false,
      },
      resolvedFromPrefix: false,
      secureReference: `${parsed.owner}/${parsed.repo}@${parsed.version}`,
      securityNotes: [
        "You are already using a SHA-pinned reference. This is the most secure approach.",
        "Commit SHAs are inherently immutable and cannot be changed.",
      ],
      rateLimitRemaining: client.getRateLimitInfo()?.remaining,
    };
  }

  let latestVersion: VersionInfo | null = null;
  let requestedVersion: VersionInfo | null = null;
  let resolvedFromPrefix = false;
  let allVersions: VersionInfo[] | undefined;

  // Get the latest release
  try {
    const latestRelease = await client.getLatestRelease(
      parsed.owner,
      parsed.repo,
    );
    latestVersion = await releaseToVersionInfo(
      client,
      parsed.owner,
      parsed.repo,
      latestRelease,
    );
  } catch (error) {
    // Repository might not use GitHub releases
    if (!(error instanceof Error && error.message.includes("Not found"))) {
      throw error;
    }
  }

  // If a version was requested, look it up
  if (parsed.version) {
    try {
      // First try exact match
      const release = await client.getReleaseByTag(
        parsed.owner,
        parsed.repo,
        parsed.version,
      );
      requestedVersion = await releaseToVersionInfo(
        client,
        parsed.owner,
        parsed.repo,
        release,
      );
    } catch (error) {
      // If exact match fails and it's a major version, try to find matching release
      if (
        error instanceof Error &&
        error.message.includes("Not found") &&
        isMajorVersionOnly(parsed.version)
      ) {
        const matchingRelease = await client.findReleaseByVersionPrefix(
          parsed.owner,
          parsed.repo,
          parsed.version,
        );
        if (matchingRelease) {
          requestedVersion = await releaseToVersionInfo(
            client,
            parsed.owner,
            parsed.repo,
            matchingRelease,
          );
          resolvedFromPrefix = true;
        }
      }

      // If still not found, try to get the commit SHA directly from the tag
      if (!requestedVersion) {
        try {
          const commitSha = await client.getCommitShaForTag(
            parsed.owner,
            parsed.repo,
            parsed.version,
          );
          requestedVersion = {
            tag: parsed.version,
            commitSha,
            immutable: false, // Unknown since it's not a release
            publishedAt: null,
            isPrerelease: false,
          };
        } catch {
          // Tag doesn't exist
          throw new Error(
            `Could not find version "${parsed.version}" for ${parsed.owner}/${parsed.repo}`,
          );
        }
      }
    }
  }

  // Get all versions if requested
  if (input.include_all_versions) {
    const releases = await client.listReleases(parsed.owner, parsed.repo);
    allVersions = await Promise.all(
      releases
        .filter((r) => !r.draft)
        .map((r) => releaseToVersionInfo(client, parsed.owner, parsed.repo, r)),
    );
  }

  // Determine which version to use for the secure reference
  const targetVersion = requestedVersion || latestVersion;

  if (!targetVersion) {
    throw new Error(
      `Could not find any releases for ${parsed.owner}/${parsed.repo}. ` +
        `The repository may not use GitHub releases.`,
    );
  }

  const secureReference = formatSecureActionReference(
    parsed.owner,
    parsed.repo,
    targetVersion.commitSha,
    targetVersion.tag,
  );

  const securityNotes = generateSecurityNotes(
    targetVersion,
    resolvedFromPrefix,
    parsed.version,
  );

  return {
    action: `${parsed.owner}/${parsed.repo}`,
    latestVersion,
    requestedVersion,
    resolvedFromPrefix,
    secureReference,
    securityNotes,
    allVersions,
    rateLimitRemaining: client.getRateLimitInfo()?.remaining,
  };
}
