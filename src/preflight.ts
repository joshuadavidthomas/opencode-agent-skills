/**
 * Client-side skill matching for skill evaluation.
 *
 * Uses heuristic gates and local search to match skills to user messages
 * without requiring LLM calls.
 */

import MiniSearch from "minisearch";
import { createHash } from "node:crypto";
import type { SkillSummary } from "./skills";

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
export function isMetaConversation(message: string): boolean {
  const trimmed = message.trim();
  
  // Empty messages are meta
  if (!trimmed) {
    return true;
  }
  
  // Short approvals: yes, no, ok, sure, nope, yep, yeah, nah
  if (/^(yes|no|ok|sure|nope|yep|yeah|nah)\s*$/i.test(trimmed)) {
    return true;
  }
  
  // Numbered responses: "1", "2.", "3 ", etc.
  if (/^\d+(\.|\s|$)/.test(trimmed)) {
    return true;
  }
  
  // Questions to assistant (case insensitive)
  if (/^(what|why|how|when|where|who|can you|could you|would you|do you)/i.test(trimmed)) {
    return true;
  }
  
  // Meta-discussion phrases (case insensitive)
  if (/(what do you think|your thoughts|any ideas|suggestions|recommend)/i.test(trimmed)) {
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
export function querySkillIndex(
  index: MiniSearch<SkillDocument>,
  query: string,
  topK: number,
  threshold: number
): SkillMatch[] {
  const results = index.search(query, { boost: { name: 2 }, fuzzy: 0.2, prefix: true });

  // Filter by threshold and take top K
  const matches = results
    .filter((result) => result.score >= threshold)
    .slice(0, topK)
    .map((result) => ({
      name: result.name as string,
      score: result.score,
    }));

  console.debug("Skill match scores:", matches);
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
export function matchSkills(
  userMessage: string,
  availableSkills: SkillSummary[]
): MatchResult {
  // Step 1: Check heuristic gate
  if (isMetaConversation(userMessage)) {
    return {
      matched: false,
      skills: [],
      reason: "Meta-conversation detected",
    };
  }

  // Handle empty skills list
  if (availableSkills.length === 0) {
    return {
      matched: false,
      skills: [],
      reason: "No skills available",
    };
  }

  // Step 2: Get or build index
  const index = getOrBuildIndex(availableSkills);

  // Step 3: Query index (top 5 results, threshold 5.0)
  const matches = querySkillIndex(index, userMessage, 5, 5.0);

  // Step 4: Return result
  if (matches.length > 0) {
    return {
      matched: true,
      skills: matches.map((m) => m.name),
      reason: "Matched via local search",
    };
  }

  // Step 5: No skills found
  return {
    matched: false,
    skills: [],
    reason: "No relevant skills found",
  };
}
