#!/usr/bin/env bun
/**
 * Model Score Analysis Script
 * 
 * Runs test queries across all models, collects structured results,
 * and computes accuracy, speed, and efficiency metrics.
 * 
 * Outputs both terminal tables and JSON for further analysis.
 */

import { EmbeddingService } from "./src/embeddings/service";
import { MODELS } from "./src/embeddings/models";
import { getSkillSummaries } from "./src/skills";
import * as fs from "node:fs/promises";

interface TestCase {
  query: string;
  expected: string[];  // One or more acceptable answers
}

interface ModelResult {
  modelName: string;
  query: string;
  topMatch: string;
  topScore: number;
  secondMatch: string;
  secondScore: number;
  scoreGap: number;  // Difference between #1 and #2
  latencyMs: number;
  isCorrect: boolean;
}

interface ModelSummary {
  modelName: string;
  totalQueries: number;
  correctAnswers: number;
  accuracy: number;
  avgScore: number;
  avgLatency: number;
  avgScoreGap: number;
  sizeMB: number;
  efficiency: number;  // (avgScore * accuracy) / avgLatency * 1000
  sizeAwareEfficiency: number;  // efficiency / sqrt(sizeMB)
  results: ModelResult[];
}

const TEST_CASES: TestCase[] = [
  { query: "help me write git commit messages", expected: ["git-helper"] },
  { query: "create a web prototype", expected: ["prototyping"] },
  { query: "refactor my code to reduce complexity", expected: ["reducing-entropy"] },
  { 
    query: "write documentation for my API", 
    expected: ["crafting-effective-readmes", "docx", "writing-clearly-and-concisely"] 
  },
  { query: "create an MCP server for GitHub", expected: ["mcp-builder"] },
  { query: "analyze this codebase structure", expected: ["researching-codebases"] },
  { query: "create a spreadsheet with formulas", expected: ["xlsx"] },
  { query: "help me brainstorm some ideas", expected: ["brainstorming"] },
  { query: "review my pull request", expected: ["reviewing-changes"] },
];

/**
 * Test a single model on a single query.
 */
async function testModelQuery(
  modelName: string,
  query: string,
  skills: Array<{ name: string; description: string }>
): Promise<{ topMatch: string; topScore: number; secondMatch: string; secondScore: number; latencyMs: number }> {
  const startTime = performance.now();
  
  try {
    const service = new EmbeddingService(modelName, 'summary');
    await service.waitUntilReady();
    
    const queryEmbedding = await service.getEmbedding("", query);
    
    const similarities = await Promise.all(
      skills.map(async (skill) => {
        const skillEmbedding = await service.getEmbedding(skill.name, skill.description);
        const score = service.cosineSimilarity(queryEmbedding, skillEmbedding);
        return { name: skill.name, score };
      })
    );
    
    similarities.sort((a, b) => b.score - a.score);
    
    const latencyMs = performance.now() - startTime;
    
    return {
      topMatch: similarities[0]?.name || "",
      topScore: similarities[0]?.score || 0,
      secondMatch: similarities[1]?.name || "",
      secondScore: similarities[1]?.score || 0,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = performance.now() - startTime;
    console.error(`Error testing ${modelName} on "${query}":`, error);
    return {
      topMatch: "",
      topScore: 0,
      secondMatch: "",
      secondScore: 0,
      latencyMs,
    };
  }
}

/**
 * Run all test cases for all models.
 */
async function runAllTests(skills: Array<{ name: string; description: string }>): Promise<ModelResult[]> {
  const results: ModelResult[] = [];
  const modelNames = Object.keys(MODELS);
  
  console.log("Running test cases across all models...\n");
  
  let totalTests = modelNames.length * TEST_CASES.length;
  let completedTests = 0;
  
  for (const modelName of modelNames) {
    console.log(`Testing ${modelName}...`);
    
    for (const testCase of TEST_CASES) {
      const { topMatch, topScore, secondMatch, secondScore, latencyMs } = await testModelQuery(
        modelName,
        testCase.query,
        skills
      );
      
      const isCorrect = testCase.expected.includes(topMatch);
      const scoreGap = topScore - secondScore;
      
      results.push({
        modelName,
        query: testCase.query,
        topMatch,
        topScore,
        secondMatch,
        secondScore,
        scoreGap,
        latencyMs,
        isCorrect,
      });
      
      completedTests++;
      process.stdout.write(`\rProgress: ${completedTests}/${totalTests} tests completed`);
    }
  }
  
  console.log("\n\nAll tests completed!\n");
  
  return results;
}

/**
 * Compute summary statistics for each model.
 */
function computeSummaries(results: ModelResult[]): ModelSummary[] {
  const modelNames = [...new Set(results.map(r => r.modelName))];
  
  return modelNames.map(modelName => {
    const modelResults = results.filter(r => r.modelName === modelName);
    const correctAnswers = modelResults.filter(r => r.isCorrect).length;
    const totalQueries = modelResults.length;
    const accuracy = correctAnswers / totalQueries;
    
    const avgScore = modelResults.reduce((sum, r) => sum + r.topScore, 0) / totalQueries;
    const avgLatency = modelResults.reduce((sum, r) => sum + r.latencyMs, 0) / totalQueries;
    const avgScoreGap = modelResults.reduce((sum, r) => sum + r.scoreGap, 0) / totalQueries;
    
    const efficiency = (avgScore * accuracy) / avgLatency * 1000;
    
    // Get model size from MODELS registry
    const modelConfig = MODELS[modelName];
    const sizeMB = modelConfig?.sizeMB || 0;
    
    // Size-aware efficiency: penalize larger models by sqrt(size)
    // This means a 400MB model needs to be 20x better than a 1MB model to have same score
    const sizeAwareEfficiency = sizeMB > 0 ? efficiency / Math.sqrt(sizeMB) : efficiency;
    
    return {
      modelName,
      totalQueries,
      correctAnswers,
      accuracy,
      avgScore,
      avgLatency,
      avgScoreGap,
      sizeMB,
      efficiency,
      sizeAwareEfficiency,
      results: modelResults,
    };
  });
}

/**
 * Format summary as terminal table.
 */
function formatSummaryTable(summaries: ModelSummary[]): string {
  const lines: string[] = [];
  
  lines.push("");
  lines.push("═".repeat(140));
  lines.push("MODEL PERFORMANCE SUMMARY");
  lines.push("═".repeat(140));
  lines.push("");
  
  // Header
  lines.push(
    "Model".padEnd(25) +
    "Correct".padEnd(12) +
    "Accuracy".padEnd(12) +
    "Avg Score".padEnd(12) +
    "Avg Latency".padEnd(15) +
    "Score Gap".padEnd(12) +
    "Size".padEnd(10) +
    "Efficiency".padEnd(12) +
    "Size-Aware"
  );
  lines.push("─".repeat(140));
  
  // Sort by size-aware efficiency (descending)
  const sorted = [...summaries].sort((a, b) => b.sizeAwareEfficiency - a.sizeAwareEfficiency);
  
  for (const summary of sorted) {
    lines.push(
      summary.modelName.padEnd(25) +
      `${summary.correctAnswers}/${summary.totalQueries}`.padEnd(12) +
      `${(summary.accuracy * 100).toFixed(1)}%`.padEnd(12) +
      summary.avgScore.toFixed(4).padEnd(12) +
      `${summary.avgLatency.toFixed(0)}ms`.padEnd(15) +
      summary.avgScoreGap.toFixed(4).padEnd(12) +
      `${summary.sizeMB}MB`.padEnd(10) +
      summary.efficiency.toFixed(2).padEnd(12) +
      summary.sizeAwareEfficiency.toFixed(2)
    );
  }
  
  lines.push("═".repeat(140));
  lines.push("");
  lines.push("Efficiency = (Avg Score × Accuracy) / Avg Latency × 1000");
  lines.push("Size-Aware Efficiency = Efficiency / √(Size in MB)");
  lines.push("Higher values = better balance of speed, accuracy, and resource usage");
  lines.push("");
  
  return lines.join("\n");
}

/**
 * Format detailed results per query.
 */
function formatDetailedResults(results: ModelResult[]): string {
  const lines: string[] = [];
  const queries = [...new Set(results.map(r => r.query))];
  
  lines.push("");
  lines.push("═".repeat(120));
  lines.push("DETAILED RESULTS BY QUERY");
  lines.push("═".repeat(120));
  
  for (const query of queries) {
    const queryResults = results.filter(r => r.query === query);
    
    lines.push("");
    lines.push(`Query: "${query}"`);
    lines.push("─".repeat(120));
    
    // Header
    lines.push(
      "Model".padEnd(25) +
      "Top Match".padEnd(30) +
      "Score".padEnd(10) +
      "Gap".padEnd(10) +
      "Latency".padEnd(12) +
      "Correct?"
    );
    lines.push("─".repeat(120));
    
    for (const result of queryResults) {
      const correctSymbol = result.isCorrect ? "✅" : "❌";
      
      lines.push(
        result.modelName.padEnd(25) +
        result.topMatch.padEnd(30) +
        result.topScore.toFixed(4).padEnd(10) +
        result.scoreGap.toFixed(4).padEnd(10) +
        `${result.latencyMs.toFixed(0)}ms`.padEnd(12) +
        correctSymbol
      );
    }
  }
  
  lines.push("");
  lines.push("═".repeat(120));
  lines.push("");
  
  return lines.join("\n");
}

/**
 * Main entry point.
 */
async function main() {
  console.log("Model Score Analysis");
  console.log("===================\n");
  
  // Get skills
  console.log("Loading skills...");
  const skills = await getSkillSummaries(process.cwd());
  
  if (skills.length === 0) {
    console.error("No skills found in current directory");
    process.exit(1);
  }
  
  console.log(`Found ${skills.length} skills\n`);
  
  // Run all tests
  const results = await runAllTests(skills);
  
  // Compute summaries
  const summaries = computeSummaries(results);
  
  // Output terminal tables
  console.log(formatSummaryTable(summaries));
  console.log(formatDetailedResults(results));
  
  // Save JSON output
  const outputPath = "model-analysis.json";
  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        testCases: TEST_CASES,
        results,
        summaries,
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );
  
  console.log(`\n✅ Results saved to ${outputPath}\n`);
  
  // Print winners
  const efficiencyWinner = summaries.reduce((best, curr) => 
    curr.efficiency > best.efficiency ? curr : best
  );
  
  const sizeAwareWinner = summaries.reduce((best, curr) => 
    curr.sizeAwareEfficiency > best.sizeAwareEfficiency ? curr : best
  );
  
  console.log(`🏆 Winner by Raw Efficiency: ${efficiencyWinner.modelName}`);
  console.log(`   - Accuracy: ${(efficiencyWinner.accuracy * 100).toFixed(1)}%`);
  console.log(`   - Avg Score: ${efficiencyWinner.avgScore.toFixed(4)}`);
  console.log(`   - Avg Latency: ${efficiencyWinner.avgLatency.toFixed(0)}ms`);
  console.log(`   - Size: ${efficiencyWinner.sizeMB}MB`);
  console.log(`   - Efficiency: ${efficiencyWinner.efficiency.toFixed(2)}`);
  console.log("");
  
  console.log(`💎 Winner by Size-Aware Efficiency: ${sizeAwareWinner.modelName}`);
  console.log(`   - Accuracy: ${(sizeAwareWinner.accuracy * 100).toFixed(1)}%`);
  console.log(`   - Avg Score: ${sizeAwareWinner.avgScore.toFixed(4)}`);
  console.log(`   - Avg Latency: ${sizeAwareWinner.avgLatency.toFixed(0)}ms`);
  console.log(`   - Size: ${sizeAwareWinner.sizeMB}MB`);
  console.log(`   - Efficiency: ${sizeAwareWinner.efficiency.toFixed(2)}`);
  console.log(`   - Size-Aware Efficiency: ${sizeAwareWinner.sizeAwareEfficiency.toFixed(2)}`);
  console.log("");
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
