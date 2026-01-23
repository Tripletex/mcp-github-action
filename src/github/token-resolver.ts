/**
 * Token resolver for multi-organization GitHub access
 *
 * Supports org-specific tokens via environment variables:
 * - GITHUB_TOKEN_<ORG_NAME> for specific orgs (e.g., GITHUB_TOKEN_MY_ORG)
 * - GITHUB_TOKEN as fallback
 * - gh CLI via `gh auth token` as final fallback
 *
 * Org names are normalized: hyphens converted to underscores, then uppercased
 * Example: "My-Org" -> GITHUB_TOKEN_MY_ORG
 */

export class TokenResolver {
  private tokenCache: Map<string, string | undefined> = new Map();

  /**
   * Normalize org name to environment variable format
   * "My-Org" -> "MY_ORG"
   * "Other-Org" -> "OTHER_ORG"
   */
  private normalizeOrgName(org: string): string {
    return org.replace(/-/g, "_").toUpperCase();
  }

  /**
   * Get the environment variable name for an org
   */
  getEnvVarName(org: string): string {
    return `GITHUB_TOKEN_${this.normalizeOrgName(org)}`;
  }

  /**
   * Try to get a token from gh CLI
   * Returns undefined if gh is not available or auth token command fails
   */
  private async getGhCliToken(): Promise<string | undefined> {
    try {
      // Check if gh command exists
      const checkCommand = new Deno.Command("gh", {
        args: ["--version"],
        stdout: "null",
        stderr: "null",
      });

      const checkResult = await checkCommand.output();
      if (!checkResult.success) {
        return undefined;
      }

      // Try to get the auth token
      const authCommand = new Deno.Command("gh", {
        args: ["auth", "token"],
        stdout: "piped",
        stderr: "null",
      });

      const authResult = await authCommand.output();
      if (!authResult.success) {
        return undefined;
      }

      const token = new TextDecoder().decode(authResult.stdout).trim();
      return token.length > 0 ? token : undefined;
    } catch (_error) {
      // gh command not found or other error
      return undefined;
    }
  }

  /**
   * Resolve the appropriate token for a given organization
   * Returns undefined if no token is found (will use unauthenticated requests)
   *
   * Resolution order:
   * - For specific org: GITHUB_TOKEN_<ORG> -> falls back to default token
   * - For default (org=""): GITHUB_TOKEN -> gh auth token
   */
  async resolveToken(org: string): Promise<string | undefined> {
    // Check cache first
    if (this.tokenCache.has(org)) {
      return this.tokenCache.get(org);
    }

    let token: string | undefined;

    // Try org-specific token first if org is specified
    if (org !== "") {
      token = Deno.env.get(this.getEnvVarName(org));
    }

    // If no org-specific token, try default token sources
    if (!token) {
      // Check if default token is already cached
      if (this.tokenCache.has("")) {
        token = this.tokenCache.get("");
      } else {
        // Resolve and cache default token
        token = Deno.env.get("GITHUB_TOKEN");
        if (!token) {
          token = await this.getGhCliToken();
        }
        // Cache default token for future use
        this.tokenCache.set("", token);
      }
    }

    // Cache the result for this org
    this.tokenCache.set(org, token);

    return token;
  }

  /**
   * Check which orgs have tokens configured
   * Useful for debugging/status
   */
  getConfiguredOrgs(): string[] {
    const configuredOrgs: string[] = [];
    const envVars = Object.keys(Deno.env.toObject());

    for (const envVar of envVars) {
      if (envVar.startsWith("GITHUB_TOKEN_") && envVar !== "GITHUB_TOKEN") {
        // Convert back to org name format (approximate)
        const orgPart = envVar.replace("GITHUB_TOKEN_", "");
        configuredOrgs.push(orgPart);
      }
    }

    return configuredOrgs;
  }

  /**
   * Check if a default fallback token is configured
   */
  hasDefaultToken(): boolean {
    return !!Deno.env.get("GITHUB_TOKEN");
  }
}

// Singleton instance
export const tokenResolver = new TokenResolver();
