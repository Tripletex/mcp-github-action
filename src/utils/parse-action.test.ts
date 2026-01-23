import { assertEquals, assertThrows } from "@std/assert";
import {
  formatSecureActionReference,
  getUpdateLevel,
  getUpdateRisk,
  isMajorVersionOnly,
  isSemverLike,
  matchesMajorVersion,
  parseAction,
  parseVersion,
} from "./parse-action.ts";

// ============================================================================
// parseAction tests
// ============================================================================

Deno.test("parseAction - basic action without version", () => {
  const result = parseAction("actions/checkout");
  assertEquals(result.owner, "actions");
  assertEquals(result.repo, "checkout");
  assertEquals(result.version, undefined);
  assertEquals(result.isCommitSha, false);
});

Deno.test("parseAction - action with tag version", () => {
  const result = parseAction("actions/checkout@v4");
  assertEquals(result.owner, "actions");
  assertEquals(result.repo, "checkout");
  assertEquals(result.version, "v4");
  assertEquals(result.isCommitSha, false);
});

Deno.test("parseAction - action with full semver", () => {
  const result = parseAction("actions/checkout@v4.2.1");
  assertEquals(result.owner, "actions");
  assertEquals(result.repo, "checkout");
  assertEquals(result.version, "v4.2.1");
  assertEquals(result.isCommitSha, false);
});

Deno.test("parseAction - action with commit SHA", () => {
  const result = parseAction(
    "actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332",
  );
  assertEquals(result.owner, "actions");
  assertEquals(result.repo, "checkout");
  assertEquals(result.version, "692973e3d937129bcbf40652eb9f2f61becf3332");
  assertEquals(result.isCommitSha, true);
});

Deno.test("parseAction - handles whitespace", () => {
  const result = parseAction("  actions/checkout@v4  ");
  assertEquals(result.owner, "actions");
  assertEquals(result.repo, "checkout");
  assertEquals(result.version, "v4");
});

Deno.test("parseAction - throws on invalid format", () => {
  assertThrows(
    () => parseAction("invalid"),
    Error,
    "Invalid action reference",
  );
});

Deno.test("parseAction - throws on empty string", () => {
  assertThrows(
    () => parseAction(""),
    Error,
    "Invalid action reference",
  );
});

// ============================================================================
// parseVersion tests
// ============================================================================

Deno.test("parseVersion - major only with v prefix", () => {
  const result = parseVersion("v4");
  assertEquals(result.major, 4);
  assertEquals(result.minor, 0);
  assertEquals(result.patch, 0);
  assertEquals(result.prerelease, undefined);
  assertEquals(result.raw, "v4");
});

Deno.test("parseVersion - major.minor with v prefix", () => {
  const result = parseVersion("v4.2");
  assertEquals(result.major, 4);
  assertEquals(result.minor, 2);
  assertEquals(result.patch, 0);
});

Deno.test("parseVersion - full semver with v prefix", () => {
  const result = parseVersion("v4.2.1");
  assertEquals(result.major, 4);
  assertEquals(result.minor, 2);
  assertEquals(result.patch, 1);
});

Deno.test("parseVersion - full semver without v prefix", () => {
  const result = parseVersion("1.0.0");
  assertEquals(result.major, 1);
  assertEquals(result.minor, 0);
  assertEquals(result.patch, 0);
});

Deno.test("parseVersion - with prerelease", () => {
  const result = parseVersion("v1.0.0-beta.1");
  assertEquals(result.major, 1);
  assertEquals(result.minor, 0);
  assertEquals(result.patch, 0);
  assertEquals(result.prerelease, "beta.1");
});

Deno.test("parseVersion - invalid version returns zeros", () => {
  const result = parseVersion("latest");
  assertEquals(result.major, 0);
  assertEquals(result.minor, 0);
  assertEquals(result.patch, 0);
  assertEquals(result.raw, "latest");
});

// ============================================================================
// isSemverLike tests
// ============================================================================

Deno.test("isSemverLike - v4 is semver-like", () => {
  assertEquals(isSemverLike("v4"), true);
});

Deno.test("isSemverLike - v4.2.1 is semver-like", () => {
  assertEquals(isSemverLike("v4.2.1"), true);
});

Deno.test("isSemverLike - 1.0.0 is semver-like", () => {
  assertEquals(isSemverLike("1.0.0"), true);
});

Deno.test("isSemverLike - latest is not semver-like", () => {
  assertEquals(isSemverLike("latest"), false);
});

Deno.test("isSemverLike - commit SHA is not semver-like", () => {
  assertEquals(isSemverLike("692973e3d937129bcbf40652eb9f2f61becf3332"), false);
});

// ============================================================================
// isMajorVersionOnly tests
// ============================================================================

Deno.test("isMajorVersionOnly - v4 is major only", () => {
  assertEquals(isMajorVersionOnly("v4"), true);
});

Deno.test("isMajorVersionOnly - 4 is major only", () => {
  assertEquals(isMajorVersionOnly("4"), true);
});

Deno.test("isMajorVersionOnly - v4.2 is not major only", () => {
  assertEquals(isMajorVersionOnly("v4.2"), false);
});

Deno.test("isMajorVersionOnly - v4.2.1 is not major only", () => {
  assertEquals(isMajorVersionOnly("v4.2.1"), false);
});

// ============================================================================
// getUpdateLevel tests
// ============================================================================

Deno.test("getUpdateLevel - major update", () => {
  assertEquals(getUpdateLevel("v3", "v4"), "major");
  assertEquals(getUpdateLevel("v3.9.9", "v4.0.0"), "major");
});

Deno.test("getUpdateLevel - minor update", () => {
  assertEquals(getUpdateLevel("v4.1", "v4.2"), "minor");
  assertEquals(getUpdateLevel("v4.1.9", "v4.2.0"), "minor");
});

Deno.test("getUpdateLevel - patch update", () => {
  assertEquals(getUpdateLevel("v4.2.0", "v4.2.1"), "patch");
});

Deno.test("getUpdateLevel - no update (same version)", () => {
  assertEquals(getUpdateLevel("v4.2.1", "v4.2.1"), "none");
});

Deno.test("getUpdateLevel - no update (latest is older)", () => {
  assertEquals(getUpdateLevel("v5", "v4"), "none");
  assertEquals(getUpdateLevel("v4.3", "v4.2"), "none");
  assertEquals(getUpdateLevel("v4.2.2", "v4.2.1"), "none");
});

// ============================================================================
// getUpdateRisk tests
// ============================================================================

Deno.test("getUpdateRisk - major is high risk", () => {
  assertEquals(getUpdateRisk("major"), "high");
});

Deno.test("getUpdateRisk - minor is medium risk", () => {
  assertEquals(getUpdateRisk("minor"), "medium");
});

Deno.test("getUpdateRisk - patch is low risk", () => {
  assertEquals(getUpdateRisk("patch"), "low");
});

Deno.test("getUpdateRisk - none is no risk", () => {
  assertEquals(getUpdateRisk("none"), "none");
});

// ============================================================================
// matchesMajorVersion tests
// ============================================================================

Deno.test("matchesMajorVersion - v4.2.1 matches major 4", () => {
  assertEquals(matchesMajorVersion("v4.2.1", 4), true);
});

Deno.test("matchesMajorVersion - v4.2.1 does not match major 5", () => {
  assertEquals(matchesMajorVersion("v4.2.1", 5), false);
});

// ============================================================================
// formatSecureActionReference tests
// ============================================================================

Deno.test("formatSecureActionReference - formats correctly", () => {
  const result = formatSecureActionReference(
    "actions",
    "checkout",
    "692973e3d937129bcbf40652eb9f2f61becf3332",
    "v4.2.0",
  );
  assertEquals(
    result,
    "actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.2.0",
  );
});
