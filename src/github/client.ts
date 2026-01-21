/**
 * GitHub API client for fetching release and tag information
 */

import type {
  GitHubError,
  GitHubRef,
  GitHubRelease,
  GitHubTag,
  RateLimitInfo,
} from "./types.ts";
import { tokenResolver } from "./token-resolver.ts";

const GITHUB_API_BASE = "https://api.github.com";

export class GitHubClient {
  private token: string | undefined;
  private rateLimitInfo: RateLimitInfo | null = null;
  private org: string | undefined;

  /**
   * Create a GitHub client
   * @param org - Organization name for token resolution (optional)
   * @param token - Explicit token override (optional, bypasses resolver)
   */
  constructor(org?: string, token?: string) {
    this.org = org;
    if (token) {
      this.token = token;
    } else if (org) {
      this.token = tokenResolver.resolveToken(org);
    } else {
      this.token = Deno.env.get("GITHUB_TOKEN");
    }
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
            `Consider setting GITHUB_TOKEN for higher limits.`
        );
      }
      throw new Error(`GitHub API error: ${error.message}`);
    }

    return response.json();
  }

  /**
   * List all releases for a repository
   */
  listReleases(owner: string, repo: string): Promise<GitHubRelease[]> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases`;
    return this.fetch<GitHubRelease[]>(url);
  }

  /**
   * Get the latest release for a repository
   */
  getLatestRelease(owner: string, repo: string): Promise<GitHubRelease> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/latest`;
    return this.fetch<GitHubRelease>(url);
  }

  /**
   * Get a release by tag name
   */
  getReleaseByTag(
    owner: string,
    repo: string,
    tag: string
  ): Promise<GitHubRelease> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/tags/${tag}`;
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
    tag: string
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
    versionPrefix: string
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
}
