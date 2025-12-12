#!/usr/bin/env bun
import { semanticMatchSkills, isMetaConversation } from "./src/preflight";
import { getSkillSummaries } from "./src/skills";

const skills = await getSkillSummaries(".");

const queries = [
  "make a chart from this data",
  "what do you think?",
  "it's .debug here in this repo dummy",
  "hmm, not sure about that",
  "okay cool",
];

for (const query of queries) {
  const isMeta = await isMetaConversation(query);
  const matches = await semanticMatchSkills(query, skills, 3, 0.0);
  
  console.log(`\nQuery: "${query}"`);
  console.log(`Meta: ${isMeta ? "YES (filtered)" : "no"}`);
  console.log(`Top 3 scores:`);
  for (const m of matches.slice(0, 3)) {
    console.log(`  ${m.score.toFixed(4)} - ${m.name}`);
  }
}

console.log("\n" + "=".repeat(70));
console.log("\nThreshold analysis:");
console.log("  0.40 (current) - Very conservative, high precision");
console.log("  0.30 - Balanced");
console.log("  0.25 - More lenient, catches 'make a chart'");
console.log("  0.20 - Riskier, may have false positives");
