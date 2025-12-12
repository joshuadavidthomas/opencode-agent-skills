#!/usr/bin/env bun
/**
 * Validation script for semantic search improvements.
 * Tests key cases that BM25 struggled with.
 */

import { matchSkills } from "./src/preflight";
import { getSkillSummaries } from "./src/skills";

interface TestCase {
  query: string;
  expectedSkill: string;
  description: string;
}

const testCases: TestCase[] = [
  {
    query: "i wonder about extracting tables from this spreadsheet",
    expectedSkill: "xlsx",
    description: "Should match xlsx (not pdf) for spreadsheet operations"
  },
  {
    query: "create a chart in Excel",
    expectedSkill: "xlsx",
    description: "Should match xlsx for data visualization with context"
  },
  {
    query: "what do you think about this?",
    expectedSkill: "",
    description: "Meta-conversation should return no match"
  },
  {
    query: "it's .debug here in this repo dummy",
    expectedSkill: "",
    description: "Garbage tokens should return no match"
  },
  {
    query: "help me create a git branch",
    expectedSkill: "git-helper",
    description: "Git operations should still match correctly"
  },
  {
    query: "fill out this PDF form",
    expectedSkill: "pdf",
    description: "PDF form operations should match pdf skill"
  },
  {
    query: "analyze data in my Excel file",
    expectedSkill: "xlsx",
    description: "Excel analysis should match xlsx skill"
  }
];

async function main() {
  console.log("🔍 Validating Semantic Search Implementation\n");
  console.log("=".repeat(70) + "\n");

  const skills = await getSkillSummaries(".");
  console.log(`Loaded ${skills.length} skills\n`);

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const result = await matchSkills(testCase.query, skills);
    
    const actualSkill = result.matched ? result.skills[0] : "";
    const isSuccess = testCase.expectedSkill === "" 
      ? !result.matched 
      : result.skills.includes(testCase.expectedSkill);

    const status = isSuccess ? "✅" : "❌";
    
    if (isSuccess) {
      passed++;
    } else {
      failed++;
    }

    console.log(`${status} ${testCase.description}`);
    console.log(`   Query: "${testCase.query}"`);
    console.log(`   Expected: ${testCase.expectedSkill || "no match"}`);
    console.log(`   Actual: ${actualSkill || "no match"}`);
    if (result.matched) {
      console.log(`   All matches: ${result.skills.join(", ")}`);
    }
    console.log();
  }

  console.log("=".repeat(70));
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
