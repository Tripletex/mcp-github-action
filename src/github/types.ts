/**
 * GitHub API response types for releases and tags
 */

export interface GitHubRelease {
  id: number;
  tag_name: string;
  target_commitish: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  html_url: string;
  /** Whether or not the release is immutable (protected from modification) */
  immutable?: boolean;
  assets: GitHubAsset[];
}

export interface GitHubAsset {
  id: number;
  name: string;
  size: number;
  download_count: number;
  browser_download_url: string;
}

export interface GitHubRef {
  ref: string;
  node_id: string;
  url: string;
  object: {
    sha: string;
    type: "commit" | "tag";
    url: string;
  };
}

export interface GitHubTag {
  sha: string;
  node_id: string;
  url: string;
  tagger?: {
    name: string;
    email: string;
    date: string;
  };
  object?: {
    sha: string;
    type: string;
    url: string;
  };
  message?: string;
}

export interface GitHubError {
  message: string;
  documentation_url?: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
}
