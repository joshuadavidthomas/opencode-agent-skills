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
      const matches = await matchSkills("Help me create a new branch and commit my changes", sampleSkills);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some(m => m.name === "git-helper")).toBe(true);
    });

    test("matches PDF tasks", async () => {
      const matches = await matchSkills("Extract tables from this PDF document", sampleSkills);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some(m => m.name === "pdf")).toBe(true);
    });

    test("matches document editing tasks", async () => {
      const matches = await matchSkills("Edit this Word document and track changes", sampleSkills);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some(m => m.name === "docx")).toBe(true);
    });

    test("matches brainstorming tasks", async () => {
      const matches = await matchSkills("Help me refine this rough idea into a design", sampleSkills);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some(m => m.name === "brainstorming")).toBe(true);
    });

    test("matches frontend design tasks", async () => {
      const matches = await matchSkills("Create a production-grade user interface", sampleSkills);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some(m => m.name === "frontend-design")).toBe(true);
    });
  });

  describe("multiple skill matching", () => {
    test("can match multiple skills for complex tasks", async () => {
      const matches = await matchSkills("Design a frontend interface and help me brainstorm ideas", sampleSkills);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some(m => m.name === "frontend-design" || m.name === "brainstorming")).toBe(true);
    });

    test("returns at most 5 skills (respects topK limit)", async () => {
      const manySkills: SkillSummary[] = Array.from({ length: 20 }, (_, i) => ({
        name: `skill-${i}`,
        description: "Test skill for matching testing purposes",
      }));

      const matches = await matchSkills("testing", manySkills);
      expect(matches.length).toBeLessThanOrEqual(5);
    });
  });

  describe("edge cases", () => {
    test("returns empty array when skill list is empty", async () => {
      const matches = await matchSkills("Help me with git", []);
      expect(matches).toEqual([]);
    });

    test("returns empty array for unrelated topics", async () => {
      const matches = await matchSkills("xyzabc123qwerty456", sampleSkills);
      expect(matches).toEqual([]);
    });

    test("handles very long messages", async () => {
      const longMessage = "Create a frontend interface ".repeat(100);
      const matches = await matchSkills(longMessage, sampleSkills);

      expect(matches.length).toBeGreaterThan(0);
    });

    test("handles messages with special characters", async () => {
      const matches = await matchSkills("Create git branch for feature work! @#$%^&*()", sampleSkills);

      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some(m => m.name === "git-helper")).toBe(true);
    });

    test("returns SkillMatch array with name and score", async () => {
      const matches = await matchSkills("Help with git", sampleSkills);

      expect(Array.isArray(matches)).toBe(true);
      if (matches.length > 0) {
        matches.forEach(match => {
          expect(match).toHaveProperty("name");
          expect(match).toHaveProperty("score");
          expect(typeof match.name).toBe("string");
          expect(typeof match.score).toBe("number");
        });
      }
    });
  });


  describe("consistency with original behavior", () => {
    test("returns empty array when no match", async () => {
      const matches = await matchSkills("completely unrelated query xyz123", sampleSkills);
      expect(matches).toEqual([]);
    });

    test("returns skill names as strings", async () => {
      const matches = await matchSkills("Help with git", sampleSkills);

      if (matches.length > 0) {
        matches.forEach(match => {
          expect(typeof match.name).toBe("string");
        });
      }
    });
  });
});
