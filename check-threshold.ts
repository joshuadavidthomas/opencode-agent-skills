#!/usr/bin/env bun
/**
 * Validate semantic search threshold across score distribution.
 * 
 * This script helps determine the optimal threshold by analyzing:
 * 1. Score distribution for correct vs incorrect matches
 * 2. Precision/recall at different thresholds
 * 3. False positive/negative rates
 */

import { EmbeddingService } from "./src/embeddings/service";
import { DEFAULT_MODEL } from "./src/embeddings/models";
import { getSkillSummaries } from "./src/skills";

interface TestCase {
  query: string;
  expected: string[];  // Acceptable answers
  category: "positive" | "negative";  // Should match or not
}

const TEST_CASES: TestCase[] = [
  // Clear positive cases (should match)
  { query: "help me write git commit messages", expected: ["git-helper"], category: "positive" },
  { query: "create a web prototype", expected: ["prototyping"], category: "positive" },
  { query: "refactor my code to reduce complexity", expected: ["reducing-entropy"], category: "positive" },
  { query: "write documentation for my API", expected: ["crafting-effective-readmes", "docx", "writing-clearly-and-concisely"], category: "positive" },
  { query: "create an MCP server for GitHub", expected: ["mcp-builder"], category: "positive" },
  { query: "analyze this codebase structure", expected: ["researching-codebases"], category: "positive" },
  { query: "create a spreadsheet with formulas", expected: ["xlsx"], category: "positive" },
  { query: "help me brainstorm some ideas", expected: ["brainstorming"], category: "positive" },
  { query: "review my pull request", expected: ["reviewing-changes"], category: "positive" },
  
  // Meta-conversation (should NOT match)
  { query: "yes", expected: [], category: "negative" },
  { query: "ok", expected: [], category: "negative" },
  { query: "no", expected: [], category: "negative" },
  { query: "thanks", expected: [], category: "negative" },
  { query: "hello", expected: [], category: "negative" },
  { query: "what do you think?", expected: [], category: "negative" },
  { query: "42", expected: [], category: "negative" },
  { query: "hmm", expected: [], category: "negative" },
  { query: "let me check", expected: [], category: "negative" },
  { query: "I see", expected: [], category: "negative" },
];

const THRESHOLDS = [0.20, 0.25, 0.30, 0.35, 0.40];

interface ThresholdResult {
  threshold: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
}

async function main() {
  console.log("🎯 Semantic Search Threshold Validation\n");
  
  const skills = await getSkillSummaries(".");
  console.log(`Loaded ${skills.length} skills`);
  console.log(`Using model: ${DEFAULT_MODEL}\n`);
  
  const service = new EmbeddingService(DEFAULT_MODEL, 'summary');
  await service.waitUntilReady();
  console.log("Model ready\n");
  
  // Compute scores for all test cases
  console.log("Computing similarity scores for all test cases...\n");
  const testResults = await Promise.all(
    TEST_CASES.map(async (testCase) => {
      const queryEmbedding = await service.getEmbedding("", testCase.query);
      
      const similarities = await Promise.all(
        skills.map(async (skill) => {
          const skillEmbedding = await service.getEmbedding(skill.name, skill.description);
          const score = service.cosineSimilarity(queryEmbedding, skillEmbedding);
          return { name: skill.name, score };
        })
      );
      
      similarities.sort((a, b) => b.score - a.score);
      const topScore = similarities[0]?.score || 0;
      const topMatch = similarities[0]?.name || "";
      
      return {
        testCase,
        topScore,
        topMatch,
        isCorrectMatch: testCase.expected.includes(topMatch),
      };
    })
  );
  
  // Test each threshold
  const thresholdResults: ThresholdResult[] = [];
  
  for (const threshold of THRESHOLDS) {
    let truePositives = 0;
    let falsePositives = 0;
    let trueNegatives = 0;
    let falseNegatives = 0;
    
    for (const result of testResults) {
      const matchedAnything = result.topScore >= threshold;
      const shouldMatch = result.testCase.category === "positive";
      const correctMatch = result.isCorrectMatch;
      
      if (shouldMatch) {
        // Positive cases
        if (matchedAnything && correctMatch) {
          truePositives++;
        } else {
          falseNegatives++;
        }
      } else {
        // Negative cases (meta-conversation)
        if (!matchedAnything) {
          trueNegatives++;
        } else {
          falsePositives++;
        }
      }
    }
    
    const precision = truePositives / (truePositives + falsePositives) || 0;
    const recall = truePositives / (truePositives + falseNegatives) || 0;
    const f1 = (2 * precision * recall) / (precision + recall) || 0;
    const accuracy = (truePositives + trueNegatives) / testResults.length;
    
    thresholdResults.push({
      threshold,
      truePositives,
      falsePositives,
      trueNegatives,
      falseNegatives,
      precision,
      recall,
      f1,
      accuracy,
    });
  }
  
  // Display results
  console.log("═".repeat(100));
  console.log("THRESHOLD ANALYSIS");
  console.log("═".repeat(100));
  console.log("");
  console.log(
    "Threshold".padEnd(12) +
    "TP".padEnd(6) +
    "FP".padEnd(6) +
    "TN".padEnd(6) +
    "FN".padEnd(6) +
    "Precision".padEnd(12) +
    "Recall".padEnd(12) +
    "F1".padEnd(12) +
    "Accuracy"
  );
  console.log("─".repeat(100));
  
  for (const result of thresholdResults) {
    console.log(
      result.threshold.toFixed(2).padEnd(12) +
      result.truePositives.toString().padEnd(6) +
      result.falsePositives.toString().padEnd(6) +
      result.trueNegatives.toString().padEnd(6) +
      result.falseNegatives.toString().padEnd(6) +
      result.precision.toFixed(3).padEnd(12) +
      result.recall.toFixed(3).padEnd(12) +
      result.f1.toFixed(3).padEnd(12) +
      result.accuracy.toFixed(3)
    );
  }
  
  console.log("═".repeat(100));
  console.log("");
  
  // Find optimal threshold (highest F1 score)
  const optimal = thresholdResults.reduce((best, curr) =>
    curr.f1 > best.f1 ? curr : best
  );
  
  console.log(`✨ Optimal Threshold: ${optimal.threshold.toFixed(2)}`);
  console.log(`   - F1 Score: ${optimal.f1.toFixed(3)}`);
  console.log(`   - Accuracy: ${(optimal.accuracy * 100).toFixed(1)}%`);
  console.log(`   - Precision: ${(optimal.precision * 100).toFixed(1)}%`);
  console.log(`   - Recall: ${(optimal.recall * 100).toFixed(1)}%`);
  console.log("");
  
  // Show score distribution
  console.log("═".repeat(100));
  console.log("SCORE DISTRIBUTION");
  console.log("═".repeat(100));
  console.log("");
  
  const positiveScores = testResults
    .filter(r => r.testCase.category === "positive")
    .map(r => r.topScore)
    .sort((a, b) => b - a);
  
  const negativeScores = testResults
    .filter(r => r.testCase.category === "negative")
    .map(r => r.topScore)
    .sort((a, b) => b - a);
  
  console.log("Positive Cases (should match):");
  console.log(`  Min: ${Math.min(...positiveScores).toFixed(3)}`);
  console.log(`  Max: ${Math.max(...positiveScores).toFixed(3)}`);
  console.log(`  Avg: ${(positiveScores.reduce((a, b) => a + b, 0) / positiveScores.length).toFixed(3)}`);
  console.log("");
  
  console.log("Negative Cases (should not match):");
  console.log(`  Min: ${Math.min(...negativeScores).toFixed(3)}`);
  console.log(`  Max: ${Math.max(...negativeScores).toFixed(3)}`);
  console.log(`  Avg: ${(negativeScores.reduce((a, b) => a + b, 0) / negativeScores.length).toFixed(3)}`);
  console.log("");
}

main().catch(console.error);
