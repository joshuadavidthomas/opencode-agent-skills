import type { SkillSummary } from "./skills";
import { debugLog } from "./utils";
import { getEmbedding, cosineSimilarity } from "./embeddings";

export interface SkillMatch {
  name: string;
  score: number;
}

/**
 * Pre-compute embeddings for all skills in the background.
 */
export async function precomputeSkillEmbeddings(skills: SkillSummary[]): Promise<void> {
  await Promise.all(
    skills.map(skill => 
      getEmbedding(skill.name, skill.description)
        .catch((err: unknown) => {
          debugLog(`Failed to pre-compute embedding for ${skill.name}`, err);
        })
    )
  );
  
  await debugLog("Pre-computed embeddings for all skills", { count: skills.length });
}

export async function semanticMatchSkills(
  userMessage: string,
  availableSkills: SkillSummary[],
  topK: number = 5,
  threshold: number = 0.4
): Promise<SkillMatch[]> {
  await debugLog("Semantic matching start", { query: userMessage, skillCount: availableSkills.length });

  const queryEmbedding = await getEmbedding("", userMessage);
  
  const similarities: SkillMatch[] = [];
  
  for (const skill of availableSkills) {
    const skillEmbedding = await getEmbedding(skill.name, skill.description);
    const score = cosineSimilarity(queryEmbedding, skillEmbedding);
    
    similarities.push({
      name: skill.name,
      score,
    });
  }
  
  const matches = similarities
    .filter(s => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  
  await debugLog("Semantic match scores", matches);
  
  return matches;
}

export interface MatchResult {
  matched: boolean;
  skills: string[];
  reason: string;
}

/**
 * Match skills to a user message using semantic search.
 */
export async function matchSkills(
  userMessage: string,
  availableSkills: SkillSummary[]
): Promise<MatchResult> {
  await debugLog("matchSkills entry", { message: userMessage, skillCount: availableSkills.length });

  if (availableSkills.length === 0) {
    const result = {
      matched: false,
      skills: [],
      reason: "No skills available",
    };
    await debugLog("matchSkills exit (no skills available)", result);
    return result;
  }

  const matches = await semanticMatchSkills(userMessage, availableSkills, 5, 0.30);

  if (matches.length > 0) {
    const result = {
      matched: true,
      skills: matches.map((m) => m.name),
      reason: "Matched via semantic search",
    };
    await debugLog("matchSkills exit (skills matched)", result);
    return result;
  }

  const result = {
    matched: false,
    skills: [],
    reason: "No relevant skills found",
  };
  await debugLog("matchSkills exit (no matches)", result);
  return result;
}
