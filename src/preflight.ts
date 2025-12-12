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

export async function matchSkills(
  userMessage: string,
  availableSkills: SkillSummary[],
  topK: number = 5,
  threshold: number = 0.30
): Promise<SkillMatch[]> {
  if (availableSkills.length === 0) {
    return [];
  }

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
  
  return similarities
    .filter(s => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
