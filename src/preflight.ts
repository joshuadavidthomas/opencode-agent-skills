import type { SkillSummary } from "./skills";
import { getEmbedding, cosineSimilarity } from "./embeddings";

export interface SkillMatch {
  name: string;
  score: number;
}

export async function precomputeSkillEmbeddings(skills: SkillSummary[]): Promise<void> {
  await Promise.all(
    skills.map(skill => 
      getEmbedding(skill.name, skill.description).catch(() => {})
    )
  );
}

export async function semanticMatchSkills(
  userMessage: string,
  availableSkills: SkillSummary[],
  topK: number = 5,
  threshold: number = 0.4
): Promise<SkillMatch[]> {
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
  
  return matches;
}

export interface MatchResult {
  matched: boolean;
  skills: string[];
  reason: string;
}

export async function matchSkills(
  userMessage: string,
  availableSkills: SkillSummary[]
): Promise<MatchResult> {
  if (availableSkills.length === 0) {
    return {
      matched: false,
      skills: [],
      reason: "No skills available",
    };
  }

  const matches = await semanticMatchSkills(userMessage, availableSkills, 5, 0.30);

  if (matches.length > 0) {
    return {
      matched: true,
      skills: matches.map((m) => m.name),
      reason: "Matched via semantic search",
    };
  }

  return {
    matched: false,
    skills: [],
    reason: "No relevant skills found",
  };
}
