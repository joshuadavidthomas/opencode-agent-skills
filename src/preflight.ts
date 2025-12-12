/**
 * Client-side skill matching for skill evaluation.
 *
 * Uses semantic search with embeddings to match skills to user messages
 * without requiring LLM calls.
 */

import type { SkillSummary } from "./skills";
import { debugLog } from "./utils";
import { getEmbedding, cosineSimilarity } from "./embeddings";

/**
 * Result from skill index query.
 */
export interface SkillMatch {
  name: string;
  score: number;
}

/**
 * Pre-compute embeddings for all skills in the background.
 * Call this at plugin startup to trigger eager embedding generation.
 * Non-blocking - runs asynchronously after model is loaded.
 *
 * @param skills - Array of skill summaries to pre-compute embeddings for
 */
export async function precomputeSkillEmbeddings(skills: SkillSummary[]): Promise<void> {
  // Generate embeddings for all skills (triggers caching)
  await Promise.all(
    skills.map(skill => 
      getEmbedding(skill.name, skill.description)
        .catch((err: unknown) => {
          // Don't fail if individual embedding fails
          debugLog(`Failed to pre-compute embedding for ${skill.name}`, err);
        })
    )
  );
  
  await debugLog("Pre-computed embeddings for all skills", { count: skills.length });
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

  // Embed the query (pass as description with empty name)
  const queryEmbedding = await getEmbedding("", userMessage);
  
  // Embed all skills and compute cosine similarity
  const similarities: SkillMatch[] = [];
  
  for (const skill of availableSkills) {
    const skillEmbedding = await getEmbedding(skill.name, skill.description);
    const score = cosineSimilarity(queryEmbedding, skillEmbedding);
    
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
