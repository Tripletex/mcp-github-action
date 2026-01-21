/**
 * Token resolver for multi-organization GitHub access
 *
 * Supports org-specific tokens via environment variables:
 * - GITHUB_TOKEN_<ORG_NAME> for specific orgs (e.g., GITHUB_TOKEN_MY_ORG)
 * - GITHUB_TOKEN as fallback
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
   * Resolve the appropriate token for a given organization
   * Returns undefined if no token is found (will use unauthenticated requests)
   */
  resolveToken(org: string): string | undefined {
    // Check cache first
    if (this.tokenCache.has(org)) {
      return this.tokenCache.get(org);
    }

    // Try org-specific token first
    const orgEnvVar = this.getEnvVarName(org);
    let token = Deno.env.get(orgEnvVar);

    // Fall back to default GITHUB_TOKEN
    if (!token) {
      token = Deno.env.get("GITHUB_TOKEN");
    }

    // Cache the result
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
