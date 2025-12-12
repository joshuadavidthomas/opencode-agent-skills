/**
 * Client-side skill matching for skill evaluation.
 *
 * Uses heuristic gates and local search to match skills to user messages
 * without requiring LLM calls.
 */

import MiniSearch from "minisearch";
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
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

/** Common English stopwords to filter from search queries */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'will', 'with', 'this', 'these', 'those', 'they',
  's', 't', 'd', 'm', 're', 've', 'll'  // Common contractions
]);

/** Module-level cache for skill search index */
let cachedIndex: CachedSkillIndex | null = null;

/**
 * Cached skill embeddings with content hash.
 */
interface CachedSkillEmbeddings {
  hash: string;
  embeddings: Float32Array[];
  skills: SkillSummary[];
}

/** Module-level cache for skill embeddings */
let cachedEmbeddings: CachedSkillEmbeddings | null = null;

/** Module-level embedder pipeline (initialized once) */
let embedder: FeatureExtractionPipeline | null = null;

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
 * Initialize the embedder pipeline once.
 * Downloads model on first use (~17MB).
 */
async function initEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedder) {
    await debugLog("Initializing embedder model (paraphrase-MiniLM-L3-v2)");
    embedder = await pipeline(
      'feature-extraction',
      'Xenova/paraphrase-MiniLM-L3-v2',
      { 
        dtype: 'q8',  // INT8 quantization
        device: 'cpu'  // CPU backend for Bun (wasm not supported)
      }
    );
    await debugLog("Embedder initialized successfully");
  }
  return embedder;
}

/**
 * Generate embedding for a text string.
 * Returns normalized Float32Array for cosine similarity.
 */
async function embedText(text: string): Promise<Float32Array> {
  const embedder = await initEmbedder();
  
  const output = await embedder(text, {
    pooling: 'mean',
    normalize: true
  });
  
  return output.data as Float32Array;
}

/**
 * Compute cosine similarity between two normalized embeddings.
 * Since embeddings are normalized, this is just the dot product.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

/**
 * Get or build skill embeddings, using cache if skills haven't changed.
 * Pre-computes embeddings for all skills at startup.
 */
export async function getOrBuildEmbeddings(skills: SkillSummary[]): Promise<CachedSkillEmbeddings> {
  const hash = hashSkills(skills);
  
  if (cachedEmbeddings && cachedEmbeddings.hash === hash) {
    await debugLog("Using cached skill embeddings", { skillCount: skills.length });
    return cachedEmbeddings;
  }
  
  await debugLog("Building skill embeddings", { skillCount: skills.length });
  
  // Embed all skills (name + description combined)
  const texts = skills.map(s => `${s.name}: ${s.description}`);
  const embeddings: Float32Array[] = [];
  
  for (const text of texts) {
    const embedding = await embedText(text);
    embeddings.push(embedding);
  }
  
  cachedEmbeddings = { hash, embeddings, skills };
  await debugLog("Skill embeddings cached", { skillCount: skills.length, dimensions: embeddings[0]?.length });
  
  return cachedEmbeddings;
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

  // Get or build embeddings for all skills
  const skillData = await getOrBuildEmbeddings(availableSkills);
  
  // Embed the query
  const queryEmbedding = await embedText(userMessage);
  
  // Compute cosine similarity with each skill
  const similarities = skillData.embeddings.map((skillEmbedding, index) => ({
    name: skillData.skills[index]!.name,
    score: cosineSimilarity(queryEmbedding, skillEmbedding)
  }));
  
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

  // Step 2: Query using semantic search (top 5 results, threshold 0.35)
  const matches = await semanticMatchSkills(userMessage, availableSkills, 5, 0.35);

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
