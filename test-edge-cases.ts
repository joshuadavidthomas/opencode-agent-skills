#!/usr/bin/env bun
/**
 * Comprehensive edge case testing for semantic skill matching.
 * Tests overlapping skills, ambiguous queries, and synonym matching.
 */

import { semanticMatchSkills } from "./src/preflight";
import { getSkillSummaries } from "./src/skills";

interface EdgeCase {
  query: string;
  category: string;
  expectedSkills?: string[];
  notes?: string;
}

const edgeCases: EdgeCase[] = [
  // === Git Skills Overlap ===
  {
    query: "I want to work on a feature in isolation",
    category: "Git Overlap",
    expectedSkills: ["using-git-worktrees"],
    notes: "Should prefer worktrees over git-helper for isolation"
  },
  {
    query: "create a separate workspace for this task",
    category: "Git Overlap",
    expectedSkills: ["using-git-worktrees"],
  },
  {
    query: "help me with git branches",
    category: "Git Overlap",
    expectedSkills: ["git-helper"],
    notes: "Generic git task, not isolation-specific"
  },
  {
    query: "what's the best version control system",
    category: "Git Overlap",
    expectedSkills: [],
    notes: "Meta question about VCS choice, not git usage"
  },

  // === Document Format Confusion ===
  {
    query: "extract data from a document",
    category: "Document Formats",
    notes: "Too ambiguous - which format?"
  },
  {
    query: "create a professional report",
    category: "Document Formats",
    expectedSkills: ["docx"],
    notes: "Reports typically = Word docs"
  },
  {
    query: "fill out a form",
    category: "Document Formats",
    expectedSkills: ["pdf"],
    notes: "Forms usually = PDF"
  },
  {
    query: "make a slide deck",
    category: "Document Formats",
    expectedSkills: ["pptx"],
  },
  {
    query: "analyze tabular data",
    category: "Document Formats",
    expectedSkills: ["xlsx"],
  },
  {
    query: "create charts and graphs",
    category: "Document Formats",
    expectedSkills: ["xlsx"],
  },

  // === Frontend Design vs Prototyping ===
  {
    query: "build a landing page",
    category: "Frontend/Prototyping",
    notes: "Ambiguous: production or prototype?"
  },
  {
    query: "create a UI mockup to validate an idea",
    category: "Frontend/Prototyping",
    expectedSkills: ["prototyping"],
    notes: "Validation = prototyping"
  },
  {
    query: "build a production-ready dashboard",
    category: "Frontend/Prototyping",
    expectedSkills: ["frontend-design"],
    notes: "Production-ready = frontend-design"
  },
  {
    query: "quickly test out this UI concept",
    category: "Frontend/Prototyping",
    expectedSkills: ["prototyping"],
  },

  // === Writing/Documentation Skills ===
  {
    query: "improve this documentation",
    category: "Writing/Docs",
    notes: "Generic - could be README, prompts, or general writing"
  },
  {
    query: "write a better README",
    category: "Writing/Docs",
    expectedSkills: ["crafting-effective-readmes"],
  },
  {
    query: "optimize my CLAUDE.md file",
    category: "Writing/Docs",
    expectedSkills: ["improving-prompts"],
  },
  {
    query: "make this error message clearer",
    category: "Writing/Docs",
    expectedSkills: ["writing-clearly-and-concisely"],
  },
  {
    query: "improve commit message quality",
    category: "Writing/Docs",
    expectedSkills: ["git-helper"],
    notes: "Commit messages = git-helper domain"
  },

  // === SvelteKit Specificity ===
  {
    query: "help me with SvelteKit",
    category: "SvelteKit",
    notes: "Too vague - which aspect?"
  },
  {
    query: "SvelteKit routing and layouts",
    category: "SvelteKit",
    expectedSkills: ["sveltekit-structure"],
  },
  {
    query: "SvelteKit form handling",
    category: "SvelteKit",
    expectedSkills: ["sveltekit-data-flow", "sveltekit-remote-functions"],
    notes: "Could be either data-flow or remote-functions"
  },
  {
    query: "migrate from Svelte 4 to Svelte 5",
    category: "SvelteKit",
    expectedSkills: ["svelte5-runes"],
  },
  {
    query: "SvelteKit load functions",
    category: "SvelteKit",
    expectedSkills: ["sveltekit-data-flow"],
  },

  // === Meta/Process Skills ===
  {
    query: "review this code for issues",
    category: "Meta/Process",
    expectedSkills: ["reviewing-changes"],
  },
  {
    query: "find where authentication is implemented",
    category: "Meta/Process",
    expectedSkills: ["researching-codebases"],
  },
  {
    query: "help me think through this architecture",
    category: "Meta/Process",
    expectedSkills: ["brainstorming"],
  },
  {
    query: "simplify this code",
    category: "Meta/Process",
    expectedSkills: ["reducing-entropy"],
  },
  {
    query: "delete unnecessary code",
    category: "Meta/Process",
    expectedSkills: ["reducing-entropy"],
  },

  // === Synonym Matching ===
  {
    query: "spreadsheet manipulation",
    category: "Synonyms",
    expectedSkills: ["xlsx"],
  },
  {
    query: "slides and presentations",
    category: "Synonyms",
    expectedSkills: ["pptx"],
  },
  {
    query: "Word documents",
    category: "Synonyms",
    expectedSkills: ["docx"],
  },
  {
    query: "dependency management",
    category: "Synonyms",
    expectedSkills: ["detect-package-manager"],
  },
  {
    query: "issue tracking",
    category: "Synonyms",
    expectedSkills: ["bd-issue-tracking"],
  },

  // === Ambiguous/Multi-Domain ===
  {
    query: "create a data visualization",
    category: "Ambiguous",
    notes: "Could be xlsx charts or frontend-design"
  },
  {
    query: "build a CLI tool",
    category: "Ambiguous",
    expectedSkills: ["writing-utility-scripts"],
  },
  {
    query: "track this work across sessions",
    category: "Ambiguous",
    expectedSkills: ["bd-issue-tracking"],
  },

  // === Negative Cases (should match nothing) ===
  {
    query: "hello there",
    category: "Negative",
    expectedSkills: [],
  },
  {
    query: "thanks for your help",
    category: "Negative",
    expectedSkills: [],
  },
  {
    query: "42",
    category: "Negative",
    expectedSkills: [],
  },
  {
    query: "hmm interesting",
    category: "Negative",
    expectedSkills: [],
  },
];

async function main() {
  const skills = await getSkillSummaries(".");
  const threshold = 0.25;

  console.log("🧪 Edge Case Testing for Semantic Skill Matching\n");
  console.log(`Skills loaded: ${skills.length}`);
  console.log(`Threshold: ${threshold}\n`);
  console.log("=".repeat(90) + "\n");

  const results = {
    total: edgeCases.length,
    passed: 0,
    failed: 0,
    ambiguous: 0,
  };

  const categories = new Map<string, { passed: number; failed: number; ambiguous: number }>();

  for (const testCase of edgeCases) {
    const matches = await semanticMatchSkills(testCase.query, skills, 5, threshold);
    const matchedNames = matches.map(m => m.name);

    // Initialize category stats
    if (!categories.has(testCase.category)) {
      categories.set(testCase.category, { passed: 0, failed: 0, ambiguous: 0 });
    }
    const catStats = categories.get(testCase.category)!;

    // Determine pass/fail
    let status = "?";
    if (!testCase.expectedSkills) {
      // No expectation - just observe
      status = "📊";
      catStats.ambiguous++;
      results.ambiguous++;
    } else if (testCase.expectedSkills.length === 0) {
      // Should match nothing
      if (matchedNames.length === 0) {
        status = "✅";
        catStats.passed++;
        results.passed++;
      } else {
        status = "❌";
        catStats.failed++;
        results.failed++;
      }
    } else {
      // Should match specific skills
      const matched = testCase.expectedSkills.some(expected => matchedNames.includes(expected));
      if (matched) {
        status = "✅";
        catStats.passed++;
        results.passed++;
      } else {
        status = "❌";
        catStats.failed++;
        results.failed++;
      }
    }

    console.log(`${status} [${testCase.category}] "${testCase.query}"`);
    
    if (testCase.expectedSkills && testCase.expectedSkills.length > 0) {
      console.log(`   Expected: ${testCase.expectedSkills.join(", ")}`);
    }
    
    if (matchedNames.length > 0) {
      console.log(`   Matched:  ${matchedNames.join(", ")}`);
      console.log(`   Scores:   ${matches.map(m => m.score.toFixed(3)).join(", ")}`);
    } else {
      console.log(`   Matched:  (none)`);
    }
    
    if (testCase.notes) {
      console.log(`   Notes:    ${testCase.notes}`);
    }
    
    console.log();
  }

  console.log("=".repeat(90));
  console.log("\n📈 Results Summary\n");
  console.log(`Total tests: ${results.total}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`📊 Ambiguous: ${results.ambiguous}`);
  console.log(`Success rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);

  console.log("\n📊 By Category:\n");
  for (const [category, stats] of categories.entries()) {
    const total = stats.passed + stats.failed + stats.ambiguous;
    const rate = stats.passed + stats.failed > 0 
      ? ((stats.passed / (stats.passed + stats.failed)) * 100).toFixed(0) + "%"
      : "N/A";
    console.log(`  ${category.padEnd(25)} ${stats.passed}/${stats.passed + stats.failed} (${rate})`);
  }
}

main().catch(console.error);
