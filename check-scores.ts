#!/usr/bin/env bun
import { semanticMatchSkills } from "./src/preflight";
import { getSkillSummaries } from "./src/skills";

const skills = await getSkillSummaries(".");
const query = "make a chart from this data";

console.log(`Query: "${query}"\n`);

// Get all matches without threshold
const matches = await semanticMatchSkills(query, skills, 10, 0.0);

console.log("Top 10 similarity scores:");
for (const match of matches) {
  console.log(`  ${match.score.toFixed(4)} - ${match.name}`);
}

console.log(`\nThreshold is currently 0.4`);
console.log(`xlsx score: ${matches.find(m => m.name === "xlsx")?.score.toFixed(4) || "not found"}`);
