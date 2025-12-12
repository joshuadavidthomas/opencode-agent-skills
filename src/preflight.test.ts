import { describe, test, expect } from "bun:test";
import { matchSkills } from "./preflight";
import type { SkillSummary } from "./skills";

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
