/**
 * Client-side skill matching for skill evaluation.
 *
 * Uses heuristic gates and local search to match skills to user messages
 * without requiring LLM calls.
 */

import MiniSearch from "minisearch";
import { createHash } from "node:crypto";
import type { SkillSummary } from "./skills";
import { debugLog } from "./utils";

/**
 * Detect if a user message is a meta-conversation that should skip skill matching.
 * 
 * Returns true for:
 * - Short approvals: yes, no, ok, sure, nope, yep, yeah, nah
 * - Numbered responses: "1", "2.", "3 ", etc.
 * - Questions to the assistant: "what...", "why...", "how...", "can you...", etc.
 * - Meta-discussion: "what do you think", "your thoughts", "any ideas", etc.
 * 
 * @param message - The user's message to evaluate
 * @returns true if this is a meta-conversation that should skip skill matching
 */
export async function isMetaConversation(message: string): Promise<boolean> {
  const trimmed = message.trim();
  
  // Empty messages are meta
  if (!trimmed) {
    await debugLog("Meta-conversation detected: empty message");
    return true;
  }
  
  // Short approvals: yes, no, ok, sure, nope, yep, yeah, nah
  if (/^(yes|no|ok|sure|nope|yep|yeah|nah)\s*$/i.test(trimmed)) {
    await debugLog("Meta-conversation detected: short approval", { message: trimmed });
    return true;
  }
  
  // Numbered responses: "1", "2.", "3 ", etc.
  if (/^\d+(\.|\s|$)/.test(trimmed)) {
    await debugLog("Meta-conversation detected: numbered response", { message: trimmed });
    return true;
  }
  
  // Questions to assistant (case insensitive)
  if (/^(what|why|how|when|where|who|can you|could you|would you|do you)/i.test(trimmed)) {
    await debugLog("Meta-conversation detected: question to assistant", { message: trimmed });
    return true;
  }
  
  // Meta-discussion phrases (case insensitive)
  if (/(what do you think|your thoughts|any ideas|suggestions|recommend)/i.test(trimmed)) {
    await debugLog("Meta-conversation detected: meta-discussion phrase", { message: trimmed });
    return true;
  }
  
  return false;
}

/**
 * Type for skill documents in the search index.
 */
interface SkillDocument extends SkillSummary {
  id: string;
}

/**
 * Result from skill index query.
 */
export interface SkillMatch {
  name: string;
  score: number;
}

/**
 * Cached skill search index with content hash.
 */
interface CachedSkillIndex {
  hash: string;
  index: MiniSearch<SkillDocument>;
}

/** Module-level cache for skill search index */
let cachedIndex: CachedSkillIndex | null = null;

/**
 * Build a MiniSearch index over skills.
 * Configures with BM25-like scoring over name and description fields.
 *
 * @param skills - Array of skill summaries to index
 * @returns Configured MiniSearch index
 */
export function buildSkillSearchIndex(skills: SkillSummary[]): MiniSearch<SkillDocument> {
  const index = new MiniSearch<SkillDocument>({
    fields: ["name", "description"],
    storeFields: ["name"],
    searchOptions: {
      boost: { name: 2 },
      fuzzy: 0.2,
      prefix: true,
    },
  });

  const documents: SkillDocument[] = skills.map((skill) => ({
    id: skill.name,
    name: skill.name,
    description: skill.description,
  }));

  index.addAll(documents);
  return index;
}

/**
 * Query the skill search index.
 * Returns matches above the score threshold, limited to top K results.
 *
 * @param index - MiniSearch index to query
 * @param query - Search query string
 * @param topK - Maximum number of results to return
 * @param threshold - Minimum score threshold for matches
 * @returns Array of skill matches with scores
 */
export async function querySkillIndex(
  index: MiniSearch<SkillDocument>,
  query: string,
  topK: number,
  threshold: number
): Promise<SkillMatch[]> {
  const results = index.search(query, { boost: { name: 2 }, fuzzy: 0.2, prefix: true });

  // Filter by threshold and take top K
  const matches = results
    .filter((result) => result.score >= threshold)
    .slice(0, topK)
    .map((result) => ({
      name: result.name as string,
      score: result.score,
    }));

  await debugLog("Skill match scores", matches);
  return matches;
}

/**
 * Compute a hash of skills for cache invalidation.
 *
 * @param skills - Array of skill summaries
 * @returns Hash string
 */
function hashSkills(skills: SkillSummary[]): string {
  const content = JSON.stringify(
    skills.map((s) => ({ name: s.name, description: s.description }))
  );
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Get or build the skill search index, using cache if skills haven't changed.
 *
 * @param skills - Array of skill summaries
 * @returns MiniSearch index (cached or newly built)
 */
export function getOrBuildIndex(skills: SkillSummary[]): MiniSearch<SkillDocument> {
  const hash = hashSkills(skills);

  if (cachedIndex && cachedIndex.hash === hash) {
    return cachedIndex.index;
  }

  const index = buildSkillSearchIndex(skills);
  cachedIndex = { hash, index };
  return index;
}

/**
 * Result of skill matching.
 */
export interface MatchResult {
  /** Whether any skills matched */
  matched: boolean;
  /** Array of matched skill names */
  skills: string[];
  /** Reason for match or no-match */
  reason: string;
}

/**
 * Match skills to a user message using heuristic gate + local search.
 * 
 * This is the main entry point for client-side skill matching:
 * 1. Check heuristic gate - if meta-conversation, skip matching
 * 2. Build/get search index over available skills
 * 3. Query index with user message
 * 4. Return matched skills above threshold
 * 
 * @param userMessage - The user's message to evaluate
 * @param availableSkills - Available skill summaries to match against
 * @returns MatchResult with matched skills and reason
 */
export async function matchSkills(
  userMessage: string,
  availableSkills: SkillSummary[]
): Promise<MatchResult> {
  await debugLog("matchSkills entry", { message: userMessage, skillCount: availableSkills.length });

  // Step 1: Check heuristic gate
  if (await isMetaConversation(userMessage)) {
    const result = {
      matched: false,
      skills: [],
      reason: "Meta-conversation detected",
    };
    await debugLog("matchSkills exit (meta-conversation)", result);
    return result;
  }

  // Handle empty skills list
  if (availableSkills.length === 0) {
    const result = {
      matched: false,
      skills: [],
      reason: "No skills available",
    };
    await debugLog("matchSkills exit (no skills available)", result);
    return result;
  }

  // Step 2: Get or build index
  const index = getOrBuildIndex(availableSkills);

  // Step 3: Query index (top 5 results, threshold 10.0)
  const matches = await querySkillIndex(index, userMessage, 5, 10.0);

  // Step 4: Return result
  if (matches.length > 0) {
    const result = {
      matched: true,
      skills: matches.map((m) => m.name),
      reason: "Matched via local search",
    };
    await debugLog("matchSkills exit (skills matched)", result);
    return result;
  }

  // Step 5: No skills found
  const result = {
    matched: false,
    skills: [],
    reason: "No relevant skills found",
  };
  await debugLog("matchSkills exit (no matches)", result);
  return result;
}
