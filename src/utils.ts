import type { PluginInput } from "@opencode-ai/plugin";
import * as path from "node:path";
import { discoverAllSkills } from "./skills";

/**
 * Parse simple YAML frontmatter.
 * Handles the subset used by Anthropic Agent Skills Spec:
 * - Simple key: value strings
 * - Arrays (lines starting with "  - ")
 * - Nested objects (indented key: value under a parent key)
 */
export function parseYamlFrontmatter(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split('\n');
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;
  let currentObject: Record<string, string> | null = null;

  for (const line of lines) {
    // Skip empty lines
    if (line.trim() === '') continue;

    // Check for array item (starts with "  - ")
    if (line.match(/^\s{2}-\s+/) && currentKey !== null) {
      const value = line.replace(/^\s{2}-\s+/, '').trim();
      if (currentArray === null) {
        currentArray = [];
        result[currentKey] = currentArray;
      }
      currentArray.push(value);
      continue;
    }

    // Check for nested object value (starts with "  " but not "  - ")
    if (line.match(/^\s{2}\w/) && currentKey !== null) {
      const nestedMatch = line.match(/^\s{2}(\w[\w-]*)\s*:\s*(.*)$/);
      if (nestedMatch && nestedMatch[1] && nestedMatch[2] !== undefined) {
        if (currentObject === null) {
          currentObject = {};
          result[currentKey] = currentObject;
        }
        currentObject[nestedMatch[1]] = nestedMatch[2].trim();
        continue;
      }
    }

    // Top-level key: value
    const topMatch = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (topMatch && topMatch[1] && topMatch[2] !== undefined) {
      // Save any pending array/object
      currentArray = null;
      currentObject = null;

      const key = topMatch[1];
      const value = topMatch[2].trim();
      currentKey = key;

      // If value is empty, it's the start of an array or object
      if (value === '') {
        continue;
      }

      // Remove surrounding quotes if present
      const unquoted = value.replace(/^["'](.*)["']$/, '$1');
      result[key] = unquoted;
    }
  }

  return result;
}

/**
 * Calculate Levenshtein edit distance between two strings.
 * Used for fuzzy matching suggestions when skill/script names are not found.
 * @internal - exported for testing
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  
  // Create distance matrix
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i || j)
  );
  
  // Fill matrix using dynamic programming
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,                           // deletion
        dp[i]![j - 1]! + 1,                           // insertion
        dp[i - 1]![j - 1]! + (a[i - 1] !== b[j - 1] ? 1 : 0)  // substitution
      );
    }
  }
  
  return dp[m]![n]!;
}

/**
 * Find the closest matching string from a list of candidates.
 * Uses combined scoring: prefix match (strongest), substring match, then Levenshtein distance.
 * Returns the best match if similarity is above 0.4 threshold, otherwise null.
 * @internal - exported for testing
 */
export function findClosestMatch(input: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  
  const inputLower = input.toLowerCase();
  let bestMatch: string | null = null;
  let bestScore = 0;
  
  for (const candidate of candidates) {
    const candidateLower = candidate.toLowerCase();
    let score = 0;
    
    // Prefix match is strongest signal (0.9-1.0)
    if (candidateLower.startsWith(inputLower)) {
      score = 0.9 + (inputLower.length / candidateLower.length) * 0.1;
      
      // Boost score if prefix is followed by word boundary
      const nextChar = candidateLower[inputLower.length];
      if (nextChar && /[-_/.]/.test(nextChar)) {
        score += 0.05; // Word boundary bonus
      }
    } else if (inputLower.startsWith(candidateLower)) {
      score = 0.8;
    }
    // Substring match is decent (0.7)
    else if (candidateLower.includes(inputLower) || inputLower.includes(candidateLower)) {
      score = 0.7;
    }
    // Fall back to Levenshtein similarity
    else {
      const distance = levenshtein(inputLower, candidateLower);
      const maxLength = Math.max(inputLower.length, candidateLower.length);
      score = 1 - (distance / maxLength);
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }
  
  // Only return match if above threshold
  return bestScore >= 0.4 ? bestMatch : null;
}

/**
 * Check if a path is safely within a base directory (no escape via ..)
 */
export function isPathSafe(basePath: string, requestedPath: string): boolean {
  const resolved = path.resolve(basePath, requestedPath);
  return resolved.startsWith(basePath + path.sep) || resolved === basePath;
}

/**
 * Inject content into session via noReply + synthetic.
 * Content persists across context compaction.
 * Must pass model and agent to prevent mode/model switching.
 */
export type OpencodeClient = PluginInput["client"];

export interface SessionContext {
  model?: { providerID: string; modelID: string };
  agent?: string;
}

export async function injectSyntheticContent(
  client: OpencodeClient,
  sessionID: string,
  text: string,
  context?: SessionContext
): Promise<void> {
  await client.session.prompt({
    path: { id: sessionID },
    body: {
      noReply: true,
      model: context?.model,
      agent: context?.agent,
      parts: [{ type: "text", text, synthetic: true }],
    },
  });
}

/**
 * Get the current context (model + agent) for a session by querying messages.
 * This mirrors OpenCode's internal lastModel() logic to find the most recent
 * user message and extract its model/agent.
 *
 * Used during tool execution when we don't have direct access to the
 * current user message's context.
 */
export async function getSessionContext(
  client: OpencodeClient,
  sessionID: string,
  limit: number = 50
): Promise<SessionContext | undefined> {
  try {
    const response = await client.session.messages({
      path: { id: sessionID },
      query: { limit }
    });

    if (response.data) {
      // Messages are returned newest first, find the most recent user message
      for (const msg of response.data) {
        if (msg.info.role === "user" && "model" in msg.info && msg.info.model) {
          return {
            model: msg.info.model,
            agent: msg.info.agent
          };
        }
      }
    }
  } catch {
    // On error, return undefined (let opencode use its default)
  }

  return undefined;
}

/**
 * Inject the available skills list into a session.
 * Used on session start and after compaction.
 */
export async function injectSkillsList(
  directory: string,
  client: OpencodeClient,
  sessionID: string,
  context?: SessionContext
): Promise<void> {
  const skillsByName = await discoverAllSkills(directory);
  const skills = Array.from(skillsByName.values());
  
  if (skills.length === 0) return;

  const skillsList = skills
    .map(s => `- ${s.name}: ${s.description}`)
    .join('\n');

  await injectSyntheticContent(
    client,
    sessionID,
    `<available-skills>
Use the use_skill, read_skill_file, run_skill_script, and find_skills tools to work with skills.

${skillsList}
</available-skills>`,
    context
  );
}
