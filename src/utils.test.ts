/**
 * Tests for fuzzy matching utilities
 */

import { describe, test, expect } from "bun:test";
import { levenshtein, findClosestMatch } from "./utils";
import {
  isMetaConversation,
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

describe("isMetaConversation", () => {
  describe("empty messages", () => {
    test("empty string is meta", async () => {
      expect(await isMetaConversation("")).toBe(true);
    });

    test("whitespace only is meta", async () => {
      expect(await isMetaConversation("   ")).toBe(true);
      expect(await isMetaConversation("\t\n")).toBe(true);
    });
  });

  describe("short approvals", () => {
    test("detects 'yes' variations", async () => {
      expect(await isMetaConversation("yes")).toBe(true);
      expect(await isMetaConversation("Yes")).toBe(true);
      expect(await isMetaConversation("YES")).toBe(true);
      expect(await isMetaConversation("yep")).toBe(true);
      expect(await isMetaConversation("yeah")).toBe(true);
    });

    test("detects 'no' variations", async () => {
      expect(await isMetaConversation("no")).toBe(true);
      expect(await isMetaConversation("No")).toBe(true);
      expect(await isMetaConversation("NO")).toBe(true);
      expect(await isMetaConversation("nope")).toBe(true);
      expect(await isMetaConversation("nah")).toBe(true);
    });

    test("detects other short approvals", async () => {
      expect(await isMetaConversation("ok")).toBe(true);
      expect(await isMetaConversation("OK")).toBe(true);
      expect(await isMetaConversation("sure")).toBe(true);
      expect(await isMetaConversation("Sure")).toBe(true);
    });

    test("allows trailing whitespace", async () => {
      expect(await isMetaConversation("yes ")).toBe(true);
      expect(await isMetaConversation("no  ")).toBe(true);
      expect(await isMetaConversation("ok\t")).toBe(true);
    });

    test("rejects approvals with extra content", async () => {
      expect(await isMetaConversation("yes please")).toBe(false);
      expect(await isMetaConversation("no thanks")).toBe(false);
      expect(await isMetaConversation("okay then")).toBe(false);
    });
  });

  describe("numbered responses", () => {
    test("detects numbered list items", async () => {
      expect(await isMetaConversation("1")).toBe(true);
      expect(await isMetaConversation("2 ")).toBe(true);
      expect(await isMetaConversation("3.")).toBe(true);
      expect(await isMetaConversation("42. ")).toBe(true);
    });

    test("detects numbers at start with text", async () => {
      expect(await isMetaConversation("1 First option")).toBe(true);
      expect(await isMetaConversation("2. Second choice")).toBe(true);
      expect(await isMetaConversation("3 something else")).toBe(true);
    });

    test("rejects numbers not at start", async () => {
      expect(await isMetaConversation("Option 1")).toBe(false);
      expect(await isMetaConversation("There are 3 options")).toBe(false);
    });
  });

  describe("questions to assistant", () => {
    test("detects 'what' questions", async () => {
      expect(await isMetaConversation("what is this?")).toBe(true);
      expect(await isMetaConversation("What should I do?")).toBe(true);
      expect(await isMetaConversation("WHAT are the options?")).toBe(true);
    });

    test("detects 'why' questions", async () => {
      expect(await isMetaConversation("why did this happen?")).toBe(true);
      expect(await isMetaConversation("Why not?")).toBe(true);
    });

    test("detects 'how' questions", async () => {
      expect(await isMetaConversation("how do I do this?")).toBe(true);
      expect(await isMetaConversation("How should I proceed?")).toBe(true);
    });

    test("detects 'when/where/who' questions", async () => {
      expect(await isMetaConversation("when should I run this?")).toBe(true);
      expect(await isMetaConversation("where is the file?")).toBe(true);
      expect(await isMetaConversation("who created this?")).toBe(true);
    });

    test("detects 'can you' requests", async () => {
      expect(await isMetaConversation("can you help me?")).toBe(true);
      expect(await isMetaConversation("Can you explain this?")).toBe(true);
    });

    test("detects 'could you' requests", async () => {
      expect(await isMetaConversation("could you show me?")).toBe(true);
      expect(await isMetaConversation("Could you check this?")).toBe(true);
    });

    test("detects 'would you' requests", async () => {
      expect(await isMetaConversation("would you mind?")).toBe(true);
      expect(await isMetaConversation("Would you prefer?")).toBe(true);
    });

    test("detects 'do you' questions", async () => {
      expect(await isMetaConversation("do you understand?")).toBe(true);
      expect(await isMetaConversation("Do you know?")).toBe(true);
    });

    test("rejects questions not at start", async () => {
      expect(await isMetaConversation("I wonder what this is")).toBe(false);
      expect(await isMetaConversation("Tell me how to do this")).toBe(false);
    });
  });

  describe("meta-discussion phrases", () => {
    test("detects 'what do you think'", async () => {
      expect(await isMetaConversation("what do you think?")).toBe(true);
      expect(await isMetaConversation("What do you think about this?")).toBe(true);
      expect(await isMetaConversation("So what do you think we should do?")).toBe(true);
    });

    test("detects 'your thoughts'", async () => {
      expect(await isMetaConversation("your thoughts?")).toBe(true);
      expect(await isMetaConversation("What are your thoughts?")).toBe(true);
      expect(await isMetaConversation("I'd like your thoughts on this")).toBe(true);
    });

    test("detects 'any ideas'", async () => {
      expect(await isMetaConversation("any ideas?")).toBe(true);
      expect(await isMetaConversation("Do you have any ideas?")).toBe(true);
      expect(await isMetaConversation("Looking for any ideas here")).toBe(true);
    });

    test("detects 'suggestions'", async () => {
      expect(await isMetaConversation("suggestions?")).toBe(true);
      expect(await isMetaConversation("Any suggestions?")).toBe(true);
      expect(await isMetaConversation("I need suggestions for this")).toBe(true);
    });

    test("detects 'recommend'", async () => {
      expect(await isMetaConversation("what would you recommend?")).toBe(true);
      expect(await isMetaConversation("Do you recommend this approach?")).toBe(true);
      expect(await isMetaConversation("I'd like to know what you recommend")).toBe(true);
    });
  });

  describe("non-meta messages", () => {
    test("rejects clear task requests", async () => {
      expect(await isMetaConversation("Create a new file")).toBe(false);
      expect(await isMetaConversation("Fix the bug in auth.ts")).toBe(false);
      expect(await isMetaConversation("Refactor the database module")).toBe(false);
    });

    test("rejects technical descriptions", async () => {
      expect(await isMetaConversation("The function returns null")).toBe(false);
      expect(await isMetaConversation("Add error handling to the parser")).toBe(false);
      expect(await isMetaConversation("Update the tests to cover edge cases")).toBe(false);
    });

    test("rejects imperative commands", async () => {
      expect(await isMetaConversation("Run the tests")).toBe(false);
      expect(await isMetaConversation("Install dependencies")).toBe(false);
      expect(await isMetaConversation("Commit the changes")).toBe(false);
    });

    test("rejects longer descriptive text", async () => {
      expect(await isMetaConversation("I need to implement a new feature for user authentication")).toBe(false);
      expect(await isMetaConversation("The application should handle errors gracefully")).toBe(false);
      expect(await isMetaConversation("Let's add support for multiple file formats")).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("handles mixed case", async () => {
      expect(await isMetaConversation("YeS")).toBe(true);
      expect(await isMetaConversation("WhAt Is ThIs?")).toBe(true);
    });

    test("handles punctuation", async () => {
      expect(await isMetaConversation("yes.")).toBe(false); // Has extra content
      expect(await isMetaConversation("what?")).toBe(true);
      expect(await isMetaConversation("what!")).toBe(true);
    });

    test("handles leading whitespace", async () => {
      expect(await isMetaConversation("  yes")).toBe(true);
      expect(await isMetaConversation("\twhat is this?")).toBe(true);
    });
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

  describe("meta-conversation detection", () => {
    test("returns matched: false for 'yes' approval", async () => {
      const result = await matchSkills("yes", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for 'no' approval", async () => {
      const result = await matchSkills("no", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for numbered response", async () => {
      const result = await matchSkills("1", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for question to assistant", async () => {
      const result = await matchSkills("what should I do?", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for meta-discussion", async () => {
      const result = await matchSkills("what do you think?", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for empty message", async () => {
      const result = await matchSkills("", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });
  });

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

  describe("integration with heuristic gate", () => {
    test("heuristic gate takes precedence over search", async () => {
      // "yes" is a meta-conversation, even though it might match some skills
      const result = await matchSkills("yes", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.reason).toBe("Meta-conversation detected");
      // Should not have performed search
      expect(result.skills).toEqual([]);
    });

    test("passes non-meta messages to search", async () => {
      const result = await matchSkills("Fix the bug", sampleSkills);
      
      // Not a meta-conversation, so should attempt search
      expect(result.reason).not.toBe("Meta-conversation detected");
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

  describe("meta-conversation detection", () => {
    test("returns matched: false for 'yes' approval", async () => {
      const result = await matchSkills("yes", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for 'no' approval", async () => {
      const result = await matchSkills("no", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for numbered response", async () => {
      const result = await matchSkills("1", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for question to assistant", async () => {
      const result = await matchSkills("what should I do?", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for meta-discussion", async () => {
      const result = await matchSkills("what do you think?", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for empty message", async () => {
      const result = await matchSkills("", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });
  });

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

  describe("integration with heuristic gate", () => {
    test("heuristic gate takes precedence over search", async () => {
      const result = await matchSkills("yes", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.reason).toBe("Meta-conversation detected");
      expect(result.skills).toEqual([]);
    });

    test("passes non-meta messages to search", async () => {
      const result = await matchSkills("Fix the bug", sampleSkills);
      
      expect(result.reason).not.toBe("Meta-conversation detected");
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
