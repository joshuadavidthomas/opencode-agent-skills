/**
 * Tests for fuzzy matching utilities
 */

import { describe, test, expect } from "bun:test";
import { levenshtein, findClosestMatch } from "./utils";
import {
  buildSkillSearchIndex,
  querySkillIndex,
  getOrBuildIndex,
  matchSkills,
  type SkillMatch,
  type MatchResult,
} from "./preflight";
import type { SkillSummary } from "./skills";

describe("levenshtein", () => {
  test("identical strings have distance 0", async () => {
    expect(levenshtein("hello", "hello")).toBe(0);
  });

  test("completely different strings have high distance", async () => {
    expect(levenshtein("abc", "xyz")).toBe(3);
  });

  test("single character difference", async () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  test("insertion", async () => {
    expect(levenshtein("cat", "cats")).toBe(1);
  });

  test("deletion", async () => {
    expect(levenshtein("cats", "cat")).toBe(1);
  });

  test("substitution", async () => {
    expect(levenshtein("cat", "cut")).toBe(1);
  });

  test("case sensitive", async () => {
    expect(levenshtein("Cat", "cat")).toBe(1);
  });
});

describe("findClosestMatch", () => {
  test("returns null for empty candidate list", async () => {
    expect(findClosestMatch("test", [])).toBe(null);
  });

  test("exact match returns the match", async () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("pdf", candidates)).toBe("pdf");
  });

  test("prefix match - user types partial skill name", async () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("git", candidates)).toBe("git-helper");
  });

  test("prefix match - longer match", async () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("brainstorm", candidates)).toBe("brainstorming");
  });

  test("typo correction via Levenshtein", async () => {
    const candidates = ["pattern", "git-helper", "pdf"];
    expect(findClosestMatch("patern", candidates)).toBe("pattern");
  });

  test("case insensitive matching", async () => {
    const candidates = ["Brainstorming", "Git-Helper", "PDF"];
    expect(findClosestMatch("brainstorm", candidates)).toBe("Brainstorming");
  });

  test("case insensitive exact match", async () => {
    const candidates = ["Brainstorming", "Git-Helper", "PDF"];
    expect(findClosestMatch("PDF", candidates)).toBe("PDF");
  });

  test("substring match", async () => {
    const candidates = ["document-processor", "git-helper", "pdf-reader"];
    expect(findClosestMatch("pdf", candidates)).toBe("pdf-reader");
  });

  test("no close matches below threshold returns null", async () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("xyzabc", candidates)).toBe(null);
  });

  test("multiple similar candidates returns best match", async () => {
    const candidates = ["test", "testing", "tests"];
    // "test" should win because it's an exact match
    expect(findClosestMatch("test", candidates)).toBe("test");
  });

  test("prefix matching beats substring matching", async () => {
    const candidates = ["pdf-reader", "reader-pdf"];
    // "pdf-reader" starts with "pdf", "reader-pdf" only contains it
    expect(findClosestMatch("pdf", candidates)).toBe("pdf-reader");
  });

  test("handles hyphenated names", async () => {
    const candidates = ["git-helper", "github-actions", "gitlab-ci"];
    expect(findClosestMatch("git", candidates)).toBe("git-helper");
  });

  test("script path matching", async () => {
    const candidates = ["build.sh", "scripts/deploy.sh", "tools/build.sh"];
    expect(findClosestMatch("deploy", candidates)).toBe("scripts/deploy.sh");
  });

  test("typo in script name", async () => {
    const candidates = ["build.sh", "deploy.sh", "test.sh"];
    expect(findClosestMatch("biuld.sh", candidates)).toBe("build.sh");
  });
});

describe("MiniSearch skill indexing", () => {
  const sampleSkills: SkillSummary[] = [
    {
      name: "git-helper",
      description: "Provides git workflow assistance, branch management, and commit message optimization",
    },
    {
      name: "pdf",
      description: "Comprehensive PDF manipulation toolkit for extracting text and tables",
    },
    {
      name: "docx",
      description: "Document creation, editing, and analysis with support for tracked changes",
    },
    {
      name: "brainstorming",
      description: "Refines rough ideas into fully-formed designs through collaborative questioning",
    },
    {
      name: "frontend-design",
      description: "Create distinctive, production-grade frontend interfaces with high design quality",
    },
  ];

  describe("buildSkillSearchIndex", () => {
    test("builds index from skills", async () => {
      const index = buildSkillSearchIndex(sampleSkills);
      expect(index).toBeDefined();
      expect(index.documentCount).toBe(5);
    });

    test("builds empty index from empty skills", async () => {
      const index = buildSkillSearchIndex([]);
      expect(index).toBeDefined();
      expect(index.documentCount).toBe(0);
    });

    test("indexes skill names and descriptions", async () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const results = index.search("git");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.name).toBe("git-helper");
    });
  });

  describe("querySkillIndex", () => {
    test("returns relevant results for query", async () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const matches = await querySkillIndex(index, "git workflow", 5, 0);
      
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]?.name).toBe("git-helper");
      expect(matches[0]?.score).toBeGreaterThan(0);
    });

    test("respects score threshold", async () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const highThreshold = 10; // Very high threshold
      const matches = await querySkillIndex(index, "git", 5, highThreshold);
      
      // All results should have score >= threshold
      matches.forEach((match) => {
        expect(match.score).toBeGreaterThanOrEqual(highThreshold);
      });
    });

    test("respects topK limit", async () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const topK = 2;
      const matches = await querySkillIndex(index, "design", topK, 0);
      
      expect(matches.length).toBeLessThanOrEqual(topK);
    });

    test("returns empty array when no matches above threshold", async () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const matches = await querySkillIndex(index, "xyzabc123", 5, 0.1);
      
      expect(matches).toEqual([]);
    });

    test("includes score in results", async () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const matches = await querySkillIndex(index, "pdf", 5, 0);
      
      expect(matches.length).toBeGreaterThan(0);
      expect(typeof matches[0]?.score).toBe("number");
      expect(matches[0]?.score).toBeGreaterThan(0);
    });

    test("matches by description content", async () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const matches = await querySkillIndex(index, "extracting text", 5, 0);
      
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]?.name).toBe("pdf");
    });

    test("fuzzy matching works for typos", async () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const matches = await querySkillIndex(index, "bramstorming", 5, 0); // typo: brainstorming
      
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some((m) => m.name === "brainstorming")).toBe(true);
    });

    test("returns results sorted by score descending", async () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const matches = await querySkillIndex(index, "design", 5, 0);
      
      // Scores should be in descending order
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i - 1]!.score).toBeGreaterThanOrEqual(matches[i]!.score);
      }
    });
  });

  describe("getOrBuildIndex", () => {
    test("builds index on first call", async () => {
      const index = getOrBuildIndex(sampleSkills);
      expect(index).toBeDefined();
      expect(index.documentCount).toBe(5);
    });

    test("returns cached index for same skills", async () => {
      const index1 = getOrBuildIndex(sampleSkills);
      const index2 = getOrBuildIndex(sampleSkills);
      
      // Should be the exact same object reference (cached)
      expect(index1).toBe(index2);
    });

    test("rebuilds index when skills change", async () => {
      const skills1 = sampleSkills;
      const index1 = getOrBuildIndex(skills1);
      
      const skills2 = [
        ...sampleSkills,
        {
          name: "new-skill",
          description: "A brand new skill",
        },
      ];
      const index2 = getOrBuildIndex(skills2);
      
      // Should be different objects (rebuilt)
      expect(index1).not.toBe(index2);
      expect(index1.documentCount).toBe(5);
      expect(index2.documentCount).toBe(6);
    });

    test("cache invalidates when skill descriptions change", async () => {
      const skills1 = sampleSkills;
      const index1 = getOrBuildIndex(skills1);
      
      const skills2 = [
        {
          name: "git-helper",
          description: "Different description", // Changed!
        },
        ...sampleSkills.slice(1),
      ];
      const index2 = getOrBuildIndex(skills2);
      
      // Should be different objects (rebuilt)
      expect(index1).not.toBe(index2);
    });

    test("cache remains valid for identical skills in different order", async () => {
      // Note: Our hash is based on JSON.stringify which is order-sensitive
      // This test verifies current behavior
      const skills1 = sampleSkills;
      const skills2 = [...sampleSkills].reverse();
      
      const index1 = getOrBuildIndex(skills1);
      const index2 = getOrBuildIndex(skills2);
      
      // Different order = different hash = rebuild
      expect(index1).not.toBe(index2);
    });
  });

  describe("integration tests", () => {
    test("end-to-end: build index and query for relevant skills", async () => {
      const index = getOrBuildIndex(sampleSkills);
      const matches = await querySkillIndex(index, "I need help with git commits", 3, 0);
      
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]?.name).toBe("git-helper");
    });

    test("end-to-end: query for PDF manipulation", async () => {
      const index = getOrBuildIndex(sampleSkills);
      const matches = await querySkillIndex(index, "extract tables from PDF files", 3, 0);
      
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]?.name).toBe("pdf");
    });

    test("end-to-end: query for design work", async () => {
      const index = getOrBuildIndex(sampleSkills);
      const matches = await querySkillIndex(index, "create frontend interface design", 3, 0);
      
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]?.name).toBe("frontend-design");
    });
  });
});

describe("matchSkills", () => {
  const sampleSkills: SkillSummary[] = [
    {
      name: "git-helper",
      description: "Provides git workflow assistance, branch management, and commit message optimization",
    },
    {
      name: "pdf",
      description: "Comprehensive PDF manipulation toolkit for extracting text and tables",
    },
    {
      name: "docx",
      description: "Document creation, editing, and analysis with support for tracked changes",
    },
    {
      name: "brainstorming",
      description: "Refines rough ideas into fully-formed designs through collaborative questioning",
    },
    {
      name: "frontend-design",
      description: "Create distinctive, production-grade frontend interfaces with high design quality",
    },
  ];


  describe("task request matching", () => {
    test("matches git-related tasks", async () => {
      const result = await matchSkills("Help me create a new branch and commit my changes", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("git-helper");
      expect(result.reason).toBe("Matched via semantic search");
    });

    test("matches PDF tasks", async () => {
      const result = await matchSkills("Extract tables from this PDF document", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("pdf");
      expect(result.reason).toBe("Matched via semantic search");
    });

    test("matches document editing tasks", async () => {
      const result = await matchSkills("Edit this Word document and track changes", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("docx");
      expect(result.reason).toBe("Matched via semantic search");
    });

    test("matches brainstorming tasks", async () => {
      const result = await matchSkills("Help me refine this rough idea into a design", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("brainstorming");
      expect(result.reason).toBe("Matched via semantic search");
    });

    test("matches frontend design tasks", async () => {
      const result = await matchSkills("Create a production-grade user interface", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("frontend-design");
      expect(result.reason).toBe("Matched via semantic search");
    });
  });

  describe("multiple skill matching", () => {
    test("can match multiple skills for complex tasks", async () => {
      const result = await matchSkills("Design a frontend interface and help me brainstorm ideas", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      // At least one skill should match
      expect(result.skills.some((s) => s === "frontend-design" || s === "brainstorming")).toBe(true);
      expect(result.reason).toBe("Matched via semantic search");
    });

    test("returns at most 5 skills (respects topK limit)", async () => {
      const manySkills: SkillSummary[] = Array.from({ length: 20 }, (_, i) => ({
        name: `skill-${i}`,
        description: "Test skill for matching testing purposes",
      }));
      
      const result = await matchSkills("testing", manySkills);
      
      if (result.matched) {
        expect(result.skills.length).toBeLessThanOrEqual(5);
      }
    });
  });

  describe("edge cases", () => {
    test("returns no skills available when skill list is empty", async () => {
      const result = await matchSkills("Help me with git", []);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("No skills available");
    });

    test("returns no relevant skills for unrelated topics", async () => {
      const result = await matchSkills("xyzabc123qwerty456", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("No relevant skills found");
    });

    test("handles very long messages", async () => {
      const longMessage = "Create a frontend interface ".repeat(100);
      const result = await matchSkills(longMessage, sampleSkills);
      
      // Should still work with long messages
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
    });

    test("handles messages with special characters", async () => {
      // After BM25 improvements: stopwords filtered, need substantial query terms
      const result = await matchSkills("Create git branch for feature work! @#$%^&*()", sampleSkills);

      expect(result.matched).toBe(true);
      expect(result.skills).toContain("git-helper");
    });

    test("preserves MatchResult structure", async () => {
      const result = await matchSkills("Help with git", sampleSkills);
      
      expect(result).toHaveProperty("matched");
      expect(result).toHaveProperty("skills");
      expect(result).toHaveProperty("reason");
      expect(typeof result.matched).toBe("boolean");
      expect(Array.isArray(result.skills)).toBe(true);
      expect(typeof result.reason).toBe("string");
    });
  });


  describe("consistency with original behavior", () => {
    test("returns empty skills array when no match (like makePreflightCallWithTimeout)", async () => {
      const result = await matchSkills("completely unrelated query xyz123", sampleSkills);
      
      expect(result.skills).toEqual([]);
    });

    test("returns skill names as strings", async () => {
      const result = await matchSkills("Help with git", sampleSkills);
      
      if (result.skills.length > 0) {
        result.skills.forEach((skill) => {
          expect(typeof skill).toBe("string");
        });
      }
    });
  });
});

describe("matchSkills", () => {
  const sampleSkills: SkillSummary[] = [
    {
      name: "git-helper",
      description: "Provides git workflow assistance, branch management, and commit message optimization",
    },
    {
      name: "pdf",
      description: "Comprehensive PDF manipulation toolkit for extracting text and tables",
    },
    {
      name: "docx",
      description: "Document creation, editing, and analysis with support for tracked changes",
    },
    {
      name: "brainstorming",
      description: "Refines rough ideas into fully-formed designs through collaborative questioning",
    },
    {
      name: "frontend-design",
      description: "Create distinctive, production-grade frontend interfaces with high design quality",
    },
  ];


  describe("task request matching", () => {
    test("matches git-related tasks", async () => {
      const result = await matchSkills("Help me create a new branch and commit my changes", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("git-helper");
      expect(result.reason).toBe("Matched via semantic search");
    });

    test("matches PDF tasks", async () => {
      const result = await matchSkills("Extract tables from this PDF document", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("pdf");
      expect(result.reason).toBe("Matched via semantic search");
    });

    test("matches document editing tasks", async () => {
      const result = await matchSkills("Edit this Word document and track changes", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("docx");
      expect(result.reason).toBe("Matched via semantic search");
    });

    test("matches brainstorming tasks", async () => {
      const result = await matchSkills("Help me refine this rough idea into a design", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("brainstorming");
      expect(result.reason).toBe("Matched via semantic search");
    });

    test("matches frontend design tasks", async () => {
      const result = await matchSkills("Create a production-grade user interface", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("frontend-design");
      expect(result.reason).toBe("Matched via semantic search");
    });
  });

  describe("multiple skill matching", () => {
    test("can match multiple skills for complex tasks", async () => {
      const result = await matchSkills("Design a frontend interface and help me brainstorm ideas", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      // At least one skill should match
      expect(result.skills.some((s) => s === "frontend-design" || s === "brainstorming")).toBe(true);
      expect(result.reason).toBe("Matched via semantic search");
    });

    test("returns at most 5 skills (respects topK limit)", async () => {
      const manySkills: SkillSummary[] = Array.from({ length: 20 }, (_, i) => ({
        name: `skill-${i}`,
        description: "Test skill for matching testing purposes",
      }));
      
      const result = await matchSkills("testing", manySkills);
      
      if (result.matched) {
        expect(result.skills.length).toBeLessThanOrEqual(5);
      }
    });
  });

  describe("edge cases", () => {
    test("returns no skills available when skill list is empty", async () => {
      const result = await matchSkills("Help me with git", []);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("No skills available");
    });

    test("returns no relevant skills for unrelated topics", async () => {
      const result = await matchSkills("xyzabc123qwerty456", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("No relevant skills found");
    });

    test("handles very long messages", async () => {
      const longMessage = "Create a frontend interface ".repeat(100);
      const result = await matchSkills(longMessage, sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
    });

    test("handles messages with special characters", async () => {
      // After BM25 improvements: stopwords filtered, so use more substantial query
      const result = await matchSkills("Create git branch for feature work! @#$%^&*()", sampleSkills);

      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
    });

    test("preserves MatchResult structure", async () => {
      const result = await matchSkills("Help with git", sampleSkills);
      
      expect(result).toHaveProperty("matched");
      expect(result).toHaveProperty("skills");
      expect(result).toHaveProperty("reason");
      expect(typeof result.matched).toBe("boolean");
      expect(Array.isArray(result.skills)).toBe(true);
      expect(typeof result.reason).toBe("string");
    });
  });


  describe("consistency with original behavior", () => {
    test("returns empty skills array when no match", async () => {
      const result = await matchSkills("completely unrelated query xyz123", sampleSkills);
      
      expect(result.skills).toEqual([]);
    });

    test("returns skill names as strings", async () => {
      const result = await matchSkills("Help with git", sampleSkills);
      
      if (result.skills.length > 0) {
        result.skills.forEach((skill) => {
          expect(typeof skill).toBe("string");
        });
      }
    });
  });
});
