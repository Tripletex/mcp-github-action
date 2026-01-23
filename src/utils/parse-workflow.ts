/**
 * Parse GitHub Actions workflow files to extract action references
 */

import { parseAction, type ParsedAction } from "./parse-action.ts";

/**
 * Extracted action reference from a workflow
 */
export interface WorkflowAction {
  /** Original reference string (e.g., "actions/checkout@v4") */
  reference: string;
  /** Parsed action components */
  parsed: ParsedAction;
  /** Job name where the action is used */
  job?: string;
  /** Step name or index */
  step?: string;
  /** Line number in the file (approximate) */
  line?: number;
}

/**
 * Result of parsing a workflow file
 */
export interface ParsedWorkflow {
  /** All action references found */
  actions: WorkflowAction[];
  /** Workflow name if specified */
  name?: string;
  /** Any parsing errors encountered */
  errors: string[];
}

// Regex to match 'uses:' lines in workflow YAML
// Matches: uses: owner/repo@version or uses: "owner/repo@version"
const USES_REGEX = /^\s*uses:\s*["']?([^"'\s#]+)["']?/;

// Regex to match job names
const JOB_REGEX = /^(\s*)([a-zA-Z_][a-zA-Z0-9_-]*):\s*$/;

// Regex to match step names
const STEP_NAME_REGEX = /^\s*-?\s*name:\s*["']?([^"'\n]+)["']?/;

/**
 * Parse a GitHub Actions workflow YAML content and extract action references
 *
 * Note: This is a simple line-based parser, not a full YAML parser.
 * It handles the common workflow patterns but may miss edge cases.
 */
export function parseWorkflow(content: string): ParsedWorkflow {
  const actions: WorkflowAction[] = [];
  const errors: string[] = [];
  const lines = content.split("\n");

  let currentJob: string | undefined;
  let currentStep: string | undefined;
  let stepIndex = 0;
  let inJobs = false;
  let inSteps = false;
  let workflowName: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Check for workflow name
    if (line.match(/^name:\s*["']?([^"'\n]+)["']?/)) {
      const match = line.match(/^name:\s*["']?([^"'\n]+)["']?/);
      if (match) {
        workflowName = match[1].trim();
      }
    }

    // Check for jobs section
    if (line.match(/^jobs:\s*$/)) {
      inJobs = true;
      continue;
    }

    // Check for job definition (must be in jobs section)
    if (inJobs) {
      const jobMatch = line.match(JOB_REGEX);
      if (jobMatch) {
        const indent = jobMatch[1].length;
        // Job definitions are typically at indent level 2
        if (indent <= 4) {
          currentJob = jobMatch[2];
          inSteps = false;
          stepIndex = 0;
        }
      }
    }

    // Check for steps section
    if (line.match(/^\s+steps:\s*$/)) {
      inSteps = true;
      stepIndex = 0;
      currentStep = undefined;
      continue;
    }

    // Check for step name
    if (inSteps) {
      const stepMatch = line.match(STEP_NAME_REGEX);
      if (stepMatch) {
        currentStep = stepMatch[1].trim();
      }

      // Check for new step (starts with -)
      if (line.match(/^\s+-\s/)) {
        stepIndex++;
        if (!line.match(STEP_NAME_REGEX)) {
          currentStep = undefined;
        }
      }
    }

    // Check for uses directive
    const usesMatch = line.match(USES_REGEX);
    if (usesMatch) {
      const reference = usesMatch[1].trim();

      // Skip local actions (./path/to/action)
      if (reference.startsWith("./") || reference.startsWith("../")) {
        continue;
      }

      // Skip docker:// references
      if (reference.startsWith("docker://")) {
        continue;
      }

      try {
        const parsed = parseAction(reference);
        actions.push({
          reference,
          parsed,
          job: currentJob,
          step: currentStep || `Step ${stepIndex}`,
          line: lineNumber,
        });
      } catch (error) {
        errors.push(
          `Line ${lineNumber}: Failed to parse action "${reference}": ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }
  }

  return {
    actions,
    name: workflowName,
    errors,
  };
}

/**
 * Extract unique action references from a workflow
 * Returns deduplicated list of owner/repo combinations
 */
export function getUniqueActions(workflow: ParsedWorkflow): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const action of workflow.actions) {
    const key = `${action.parsed.owner}/${action.parsed.repo}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(action.reference);
    }
  }

  return unique;
}
