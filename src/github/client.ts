/**
 * GitHub API client for fetching release and tag information
 */

import type {
  GitHubError,
  GitHubRef,
  GitHubRelease,
  GitHubRepository,
  GitHubTag,
  RateLimitInfo,
} from "./types.ts";
import { tokenResolver } from "./token-resolver.ts";
import { configResolver } from "./config.ts";

const GITHUB_API_BASE = "https://api.github.com";

export class GitHubClient {
  private token: string | undefined;
  private tokenResolved = false;
  private tokenPromise: Promise<void> | null = null;
  private rateLimitInfo: RateLimitInfo | null = null;
  private org: string | undefined;

  /**
   * Create a GitHub client
   * @param org - Organization name for token resolution (optional)
   */
  constructor(org?: string) {
    this.org = org;
  }

  /**
   * Ensure token is resolved before making requests
   */
  private async ensureToken(): Promise<void> {
    if (this.tokenResolved) {
      return;
    }

    if (this.tokenPromise) {
      return await this.tokenPromise;
    }

    this.tokenPromise = (async () => {
      this.token = await tokenResolver.resolveToken(this.org ?? "");
      this.tokenResolved = true;
      this.tokenPromise = null;
    })();

    return this.tokenPromise;
  }

  /**
   * Get the organization this client is configured for
   */
  getOrg(): string | undefined {
    return this.org;
  }

  /**
   * Check if this client has a token configured
   */
  hasToken(): boolean {
    return !!this.token;
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mcp-github-actions/1.0.0",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    return headers;
  }

  private updateRateLimitInfo(response: Response): void {
    const limit = response.headers.get("x-ratelimit-limit");
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    const used = response.headers.get("x-ratelimit-used");

    if (limit && remaining && reset && used) {
      this.rateLimitInfo = {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        reset: parseInt(reset, 10),
        used: parseInt(used, 10),
      };
    }
  }

  getRateLimitInfo(): RateLimitInfo | null {
    return this.rateLimitInfo;
  }

  private async fetch<T>(url: string): Promise<T> {
    // Ensure token is resolved before making request
    await this.ensureToken();

    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    this.updateRateLimitInfo(response);

    if (!response.ok) {
      const error: GitHubError = await response.json();
      if (response.status === 404) {
        throw new Error(`Not found: ${error.message}`);
      }
      if (response.status === 403 && this.rateLimitInfo?.remaining === 0) {
        const resetDate = new Date(this.rateLimitInfo.reset * 1000);
        throw new Error(
          `Rate limit exceeded. Resets at ${resetDate.toISOString()}. ` +
            `Consider setting GITHUB_TOKEN for higher limits.`,
        );
      }
      throw new Error(`GitHub API error: ${error.message}`);
    }

    return response.json();
  }

  /**
   * List all releases for a repository (unfiltered)
   */
  private listReleasesRaw(
    owner: string,
    repo: string,
  ): Promise<GitHubRelease[]> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases`;
    return this.fetch<GitHubRelease[]>(url);
  }

  /**
   * List all releases for a repository, filtered by minimum age if configured
   */
  async listReleases(owner: string, repo: string): Promise<GitHubRelease[]> {
    const releases = await this.listReleasesRaw(owner, repo);
    return this.filterReleasesByAge(releases);
  }

  /**
   * Get the age of a release in days
   */
  private getReleaseAgeDays(publishedAt: string | null): number | null {
    if (!publishedAt) {
      return null;
    }
    const publishedDate = new Date(publishedAt);
    const now = new Date();
    return (now.getTime() - publishedDate.getTime()) / (1000 * 60 * 60 * 24);
  }

  /**
   * Check if a release is old enough based on MIN_RELEASE_AGE_DAYS
   */
  private isReleaseOldEnough(publishedAt: string | null): boolean {
    const minAgeDays = configResolver.getMinReleaseAgeDays();

    // If no minimum age configured, all releases are valid
    if (minAgeDays === 0) {
      return true;
    }

    // If no published date, we can't determine age - be conservative and include it
    if (!publishedAt) {
      return true;
    }

    const ageDays = this.getReleaseAgeDays(publishedAt);
    return ageDays !== null && ageDays >= minAgeDays;
  }

  /**
   * Filter releases by minimum age configuration
   */
  private filterReleasesByAge(releases: GitHubRelease[]): GitHubRelease[] {
    const minAgeDays = configResolver.getMinReleaseAgeDays();
    if (minAgeDays === 0) {
      return releases;
    }

    return releases.filter((release) =>
      this.isReleaseOldEnough(release.published_at)
    );
  }

  /**
   * Get the latest release for a repository (unfiltered)
   */
  private getLatestReleaseRaw(
    owner: string,
    repo: string,
  ): Promise<GitHubRelease> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/latest`;
    return this.fetch<GitHubRelease>(url);
  }

  /**
   * Get the latest release for a repository that meets the minimum age requirement.
   * If MIN_RELEASE_AGE_DAYS is set and the latest release is too new,
   * falls back to finding an older release that meets the requirement.
   */
  async getLatestRelease(owner: string, repo: string): Promise<GitHubRelease> {
    const latestRelease = await this.getLatestReleaseRaw(owner, repo);

    // If no minimum age configured or release is old enough, return it
    if (this.isReleaseOldEnough(latestRelease.published_at)) {
      return latestRelease;
    }

    // Latest release is too new, find an older one
    const releases = await this.listReleasesRaw(owner, repo);
    const eligibleReleases = this.filterReleasesByAge(
      releases.filter((r) => !r.draft && !r.prerelease),
    );

    if (eligibleReleases.length === 0) {
      const minAge = configResolver.getMinReleaseAgeDays();
      const releaseAge = this.getReleaseAgeDays(latestRelease.published_at);
      throw new Error(
        `No releases found that are at least ${minAge} days old. ` +
          `Latest release "${latestRelease.tag_name}" is ${
            releaseAge?.toFixed(1)
          } days old.`,
      );
    }

    return eligibleReleases[0];
  }

  /**
   * Get a release by tag name
   */
  getReleaseByTag(
    owner: string,
    repo: string,
    tag: string,
  ): Promise<GitHubRelease> {
    const url =
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/tags/${tag}`;
    return this.fetch<GitHubRelease>(url);
  }

  /**
   * Get the git reference for a tag (to get the commit SHA)
   */
  getTagRef(owner: string, repo: string, tag: string): Promise<GitHubRef> {
    const tagName = tag.startsWith("refs/tags/") ? tag : `refs/tags/${tag}`;
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/${tagName}`;
    return this.fetch<GitHubRef>(url);
  }

  /**
   * Get detailed tag object (for annotated tags)
   */
  getTag(owner: string, repo: string, sha: string): Promise<GitHubTag> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/tags/${sha}`;
    return this.fetch<GitHubTag>(url);
  }

  /**
   * Get the commit SHA for a tag, handling both lightweight and annotated tags
   */
  async getCommitShaForTag(
    owner: string,
    repo: string,
    tag: string,
  ): Promise<string> {
    const ref = await this.getTagRef(owner, repo, tag);

    // If it's a direct commit reference, return the SHA
    if (ref.object.type === "commit") {
      return ref.object.sha;
    }

    // If it's an annotated tag, we need to dereference it
    if (ref.object.type === "tag") {
      const tagObject = await this.getTag(owner, repo, ref.object.sha);
      // The object field points to the actual commit
      if (tagObject.object) {
        return tagObject.object.sha;
      }
    }

    return ref.object.sha;
  }

  /**
   * Find a release that matches a version prefix (e.g., "v4" matches "v4.2.0")
   */
  async findReleaseByVersionPrefix(
    owner: string,
    repo: string,
    versionPrefix: string,
  ): Promise<GitHubRelease | null> {
    const releases = await this.listReleases(owner, repo);

    // Normalize the prefix
    const prefix = versionPrefix.startsWith("v")
      ? versionPrefix
      : `v${versionPrefix}`;

    // Find releases that match the prefix, sorted by semantic version
    const matchingReleases = releases
      .filter((r) => !r.draft && r.tag_name.startsWith(prefix))
      .sort((a, b) => {
        // Simple semver comparison - prefer exact match first
        if (a.tag_name === prefix) return -1;
        if (b.tag_name === prefix) return 1;
        // Then sort by version number descending
        return b.tag_name.localeCompare(a.tag_name, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });

    return matchingReleases[0] || null;
  }

  /**
   * Get repository information including default branch
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}`;
    return await this.fetch<GitHubRepository>(url);
  }

  /**
   * Get repository default branch name
   */
  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const repository = await this.getRepository(owner, repo);
    return repository.default_branch;
  }

  /**
   * Get file content from repository at specific ref
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param path - File path (e.g., "README.md")
   * @param ref - Branch, tag, or commit SHA (optional, defaults to repo default branch)
   */
  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string> {
    // Ensure token is resolved before making request
    await this.ensureToken();

    // Build URL with optional ref parameter
    let url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`;
    if (ref) {
      url += `?ref=${encodeURIComponent(ref)}`;
    }

    // Use Accept header to get raw content instead of JSON
    const response = await fetch(url, {
      headers: {
        ...this.getHeaders(),
        Accept: "application/vnd.github.raw",
      },
    });

    this.updateRateLimitInfo(response);

    if (!response.ok) {
      const error: GitHubError = await response.json();
      if (response.status === 404) {
        throw new Error(
          `File not found: ${path}${ref ? ` at ref ${ref}` : ""}`,
        );
      }
      if (response.status === 403 && this.rateLimitInfo?.remaining === 0) {
        const resetDate = new Date(this.rateLimitInfo.reset * 1000);
        throw new Error(
          `Rate limit exceeded. Resets at ${resetDate.toISOString()}. ` +
            `Consider setting GITHUB_TOKEN for higher limits.`,
        );
      }
      throw new Error(`GitHub API error: ${error.message}`);
    }

    return response.text();
  }
}
