/**
 * Client-side skill matching for skill evaluation.
 *
 * Uses semantic search with embeddings to match skills to user messages
 * without requiring LLM calls.
 */

import MiniSearch from "minisearch";
import { createHash } from "node:crypto";
import type { SkillSummary } from "./skills";
import { debugLog } from "./utils";
import { EmbeddingService } from "./embeddings/service";
import { DEFAULT_MODEL } from "./embeddings/models";

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

/** Common English stopwords to filter from search queries */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'will', 'with', 'this', 'these', 'those', 'they',
  's', 't', 'd', 'm', 're', 've', 'll'  // Common contractions
]);

/** Module-level cache for skill search index */
let cachedIndex: CachedSkillIndex | null = null;

/** Module-level embedding service (starts loading immediately) */
const embeddingService = new EmbeddingService(DEFAULT_MODEL);

/**
 * Pre-compute embeddings for all skills in the background.
 * Call this at plugin startup to trigger eager embedding generation.
 * Non-blocking - runs asynchronously after model is loaded.
 *
 * @param skills - Array of skill summaries to pre-compute embeddings for
 */
export async function precomputeSkillEmbeddings(skills: SkillSummary[]): Promise<void> {
  // Wait for model to be ready first
  await embeddingService.waitUntilReady();
  
  // Generate embeddings for all skills (triggers caching)
  await Promise.all(
    skills.map(skill => 
      embeddingService.getEmbedding(skill.name, skill.description)
        .catch(err => {
          // Don't fail if individual embedding fails
          debugLog(`Failed to pre-compute embedding for ${skill.name}`, err);
        })
    )
  );
  
  await debugLog("Pre-computed embeddings for all skills", { count: skills.length });
}

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
      fuzzy: (term: string) => term.length >= 5 ? 0.2 : false,
      prefix: true,
      processTerm: (term) => {
        const lower = term.toLowerCase();
        
        // Filter stopwords
        if (STOPWORDS.has(lower)) {
          return null;
        }
        
        // Filter terms shorter than 3 characters
        if (lower.length < 3) {
          return null;
        }
        
        return lower;
      },
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
  const results = index.search(query, { boost: { name: 2 }, fuzzy: (term: string) => term.length >= 5 ? 0.2 : false, prefix: true });

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
 * Match skills using semantic similarity search.
 * Computes query embedding and finds skills with highest cosine similarity.
 * 
 * @param userMessage - User's message to match
 * @param availableSkills - Available skills to match against
 * @param topK - Maximum number of results
 * @param threshold - Minimum similarity threshold (0-1, typically 0.3-0.5)
 * @returns Array of skill matches with similarity scores
 */
export async function semanticMatchSkills(
  userMessage: string,
  availableSkills: SkillSummary[],
  topK: number = 5,
  threshold: number = 0.4
): Promise<SkillMatch[]> {
  await debugLog("Semantic matching start", { query: userMessage, skillCount: availableSkills.length });

  // Check if embedding service is ready
  if (!embeddingService.isReady()) {
    await debugLog("Embedding model not ready, skipping semantic matching");
    return [];
  }
  
  // Embed the query (pass as description with empty name to match old behavior)
  const queryEmbedding = await embeddingService.getEmbedding("", userMessage);
  
  // Embed all skills and compute cosine similarity
  const similarities: SkillMatch[] = [];
  
  for (const skill of availableSkills) {
    // Pass name and description separately - service will combine them
    const skillEmbedding = await embeddingService.getEmbedding(skill.name, skill.description);
    const score = embeddingService.cosineSimilarity(queryEmbedding, skillEmbedding);
    
    similarities.push({
      name: skill.name,
      score,
    });
  }
  
  // Filter by threshold and sort by score
  const matches = similarities
    .filter(s => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  
  await debugLog("Semantic match scores", matches);
  
  return matches;
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
 * Match skills to a user message using semantic search.
 * 
 * This is the main entry point for client-side skill matching:
 * 1. Query using semantic similarity (embeddings + cosine distance)
 * 2. Return matched skills above threshold
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

  // Step 2: Query using semantic search (top 5 results, threshold 0.30)
  const matches = await semanticMatchSkills(userMessage, availableSkills, 5, 0.30);

  // Step 3: Return result
  if (matches.length > 0) {
    const result = {
      matched: true,
      skills: matches.map((m) => m.name),
      reason: "Matched via semantic search",
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
