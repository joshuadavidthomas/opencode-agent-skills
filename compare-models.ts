#!/usr/bin/env bun
/**
 * Model Comparison Testing Harness
 * 
 * Compares different embedding models and strategies for skill matching.
 * 
 * Usage:
 *   bun run compare-models.ts "help me write git commit messages"
 *   bun run compare-models.ts "create a REST API" --strategy full
 *   bun run compare-models.ts "refactor code" --top 3
 */

import { EmbeddingService, type EmbeddingStrategy } from "./src/embeddings/service";
import { MODELS } from "./src/embeddings/models";
import { getSkillSummaries } from "./src/skills";

interface ModelResult {
  modelName: string;
  strategy: EmbeddingStrategy;
  matches: Array<{ name: string; score: number }>;
  latencyMs: number;
  error?: string;
}

/**
 * Test a single model with a given strategy.
 */
async function testModel(
  modelName: string,
  strategy: EmbeddingStrategy,
  query: string,
  skills: Array<{ name: string; description: string }>,
  topK: number
): Promise<ModelResult> {
  const startTime = performance.now();
  
  try {
    // Create service for this model and strategy
    const service = new EmbeddingService(modelName, strategy);
    
    // Wait for model to load
    await service.waitUntilReady();
    
    // Get query embedding
    const queryEmbedding = await service.getEmbedding("", query);
    
    // Get skill embeddings and compute similarities
    const similarities = await Promise.all(
      skills.map(async (skill) => {
        const skillEmbedding = await service.getEmbedding(skill.name, skill.description);
        const score = service.cosineSimilarity(queryEmbedding, skillEmbedding);
        return { name: skill.name, score };
      })
    );
    
    // Sort by score and take topK
    const matches = similarities
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    
    const latencyMs = performance.now() - startTime;
    
    return { modelName, strategy, matches, latencyMs };
  } catch (error) {
    const latencyMs = performance.now() - startTime;
    return {
      modelName,
      strategy,
      matches: [],
      latencyMs,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Format results as a table.
 */
function formatResults(results: ModelResult[]): string {
  const lines: string[] = [];
  
  lines.push(""); // Empty line before results
  lines.push("═".repeat(100));
  lines.push("MODEL COMPARISON RESULTS");
  lines.push("═".repeat(100));
  
  for (const result of results) {
    lines.push("");
    lines.push(`${result.modelName} (${result.strategy} strategy) - ${result.latencyMs.toFixed(0)}ms`);
    lines.push("─".repeat(100));
    
    if (result.error) {
      lines.push(`  ❌ Error: ${result.error}`);
    } else if (result.matches.length === 0) {
      lines.push("  (no matches)");
    } else {
      for (let i = 0; i < result.matches.length; i++) {
        const match = result.matches[i]!;
        lines.push(`  ${i + 1}. ${match.name.padEnd(40)} ${match.score.toFixed(4)}`);
      }
    }
  }
  
  lines.push("");
  lines.push("═".repeat(100));
  
  return lines.join("\n");
}

/**
 * Main entry point.
 */
async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  const strategyIdx = args.indexOf("--strategy");
  const strategy: EmbeddingStrategy = strategyIdx >= 0 && args[strategyIdx + 1]
    ? (args[strategyIdx + 1] as EmbeddingStrategy)
    : "summary";
  
  const topIdx = args.indexOf("--top");
  const topK = topIdx >= 0 && args[topIdx + 1]
    ? parseInt(args[topIdx + 1], 10)
    : 5;
  
  // Get query (all non-flag args)
  const flagValues = new Set([
    strategyIdx >= 0 ? args[strategyIdx + 1] : null,
    topIdx >= 0 ? args[topIdx + 1] : null,
  ].filter(Boolean));
  
  const query = args
    .filter(arg => !arg.startsWith("--") && !flagValues.has(arg))
    .join(" ");
  
  if (!query) {
    console.error("Usage: bun run compare-models.ts <query> [--strategy summary|full] [--top N]");
    console.error("");
    console.error("Examples:");
    console.error('  bun run compare-models.ts "help me write git commit messages"');
    console.error('  bun run compare-models.ts "create a REST API" --strategy full');
    console.error('  bun run compare-models.ts "refactor code" --top 3');
    process.exit(1);
  }
  
  console.log(`Query: "${query}"`);
  console.log(`Strategy: ${strategy}`);
  console.log(`Top K: ${topK}`);
  console.log("");
  console.log("Loading skills and models...");
  
  // Get skills from current directory
  const skills = await getSkillSummaries(process.cwd());
  
  if (skills.length === 0) {
    console.error("No skills found in current directory");
    process.exit(1);
  }
  
  console.log(`Found ${skills.length} skills`);
  
  // Test all models
  const modelNames = Object.keys(MODELS);
  const results: ModelResult[] = [];
  
  for (const modelName of modelNames) {
    console.log(`Testing ${modelName}...`);
    const result = await testModel(modelName, strategy, query, skills, topK);
    results.push(result);
  }
  
  // Display results
  console.log(formatResults(results));
  
  // Summary statistics
  const successful = results.filter(r => !r.error);
  if (successful.length > 0) {
    const avgLatency = successful.reduce((sum, r) => sum + r.latencyMs, 0) / successful.length;
    console.log(`Average latency: ${avgLatency.toFixed(0)}ms`);
    console.log(`Successful: ${successful.length}/${results.length}`);
  }
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
