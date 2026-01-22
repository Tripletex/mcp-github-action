/**
 * Configuration resolver for MCP GitHub Actions
 *
 * Supports configuration via environment variables:
 * - MIN_RELEASE_AGE_DAYS: Minimum age in days for releases to be considered (default: 0)
 *   Set to e.g. 5 to skip releases published within the last 5 days
 */

export class ConfigResolver {
  private configCache: Map<string, number | undefined> = new Map();

  /**
   * Get the minimum release age in days
   * Returns 0 if not configured (no filtering)
   */
  getMinReleaseAgeDays(): number {
    const cacheKey = "MIN_RELEASE_AGE_DAYS";

    if (this.configCache.has(cacheKey)) {
      return this.configCache.get(cacheKey) ?? 0;
    }

    const envValue = Deno.env.get("MIN_RELEASE_AGE_DAYS");
    let value = 0;

    if (envValue) {
      const parsed = parseInt(envValue, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        value = parsed;
      }
    }

    this.configCache.set(cacheKey, value);
    return value;
  }
}

// Singleton instance
export const configResolver = new ConfigResolver();
