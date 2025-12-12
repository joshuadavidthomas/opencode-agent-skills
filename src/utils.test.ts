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
  test("identical strings have distance 0", () => {
    expect(levenshtein("hello", "hello")).toBe(0);
  });

  test("completely different strings have high distance", () => {
    expect(levenshtein("abc", "xyz")).toBe(3);
  });

  test("single character difference", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  test("insertion", () => {
    expect(levenshtein("cat", "cats")).toBe(1);
  });

  test("deletion", () => {
    expect(levenshtein("cats", "cat")).toBe(1);
  });

  test("substitution", () => {
    expect(levenshtein("cat", "cut")).toBe(1);
  });

  test("case sensitive", () => {
    expect(levenshtein("Cat", "cat")).toBe(1);
  });
});

describe("findClosestMatch", () => {
  test("returns null for empty candidate list", () => {
    expect(findClosestMatch("test", [])).toBe(null);
  });

  test("exact match returns the match", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("pdf", candidates)).toBe("pdf");
  });

  test("prefix match - user types partial skill name", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("git", candidates)).toBe("git-helper");
  });

  test("prefix match - longer match", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("brainstorm", candidates)).toBe("brainstorming");
  });

  test("typo correction via Levenshtein", () => {
    const candidates = ["pattern", "git-helper", "pdf"];
    expect(findClosestMatch("patern", candidates)).toBe("pattern");
  });

  test("case insensitive matching", () => {
    const candidates = ["Brainstorming", "Git-Helper", "PDF"];
    expect(findClosestMatch("brainstorm", candidates)).toBe("Brainstorming");
  });

  test("case insensitive exact match", () => {
    const candidates = ["Brainstorming", "Git-Helper", "PDF"];
    expect(findClosestMatch("PDF", candidates)).toBe("PDF");
  });

  test("substring match", () => {
    const candidates = ["document-processor", "git-helper", "pdf-reader"];
    expect(findClosestMatch("pdf", candidates)).toBe("pdf-reader");
  });

  test("no close matches below threshold returns null", () => {
    const candidates = ["brainstorming", "git-helper", "pdf"];
    expect(findClosestMatch("xyzabc", candidates)).toBe(null);
  });

  test("multiple similar candidates returns best match", () => {
    const candidates = ["test", "testing", "tests"];
    // "test" should win because it's an exact match
    expect(findClosestMatch("test", candidates)).toBe("test");
  });

  test("prefix matching beats substring matching", () => {
    const candidates = ["pdf-reader", "reader-pdf"];
    // "pdf-reader" starts with "pdf", "reader-pdf" only contains it
    expect(findClosestMatch("pdf", candidates)).toBe("pdf-reader");
  });

  test("handles hyphenated names", () => {
    const candidates = ["git-helper", "github-actions", "gitlab-ci"];
    expect(findClosestMatch("git", candidates)).toBe("git-helper");
  });

  test("script path matching", () => {
    const candidates = ["build.sh", "scripts/deploy.sh", "tools/build.sh"];
    expect(findClosestMatch("deploy", candidates)).toBe("scripts/deploy.sh");
  });

  test("typo in script name", () => {
    const candidates = ["build.sh", "deploy.sh", "test.sh"];
    expect(findClosestMatch("biuld.sh", candidates)).toBe("build.sh");
  });
});

describe("isMetaConversation", () => {
  describe("empty messages", () => {
    test("empty string is meta", () => {
      expect(isMetaConversation("")).toBe(true);
    });

    test("whitespace only is meta", () => {
      expect(isMetaConversation("   ")).toBe(true);
      expect(isMetaConversation("\t\n")).toBe(true);
    });
  });

  describe("short approvals", () => {
    test("detects 'yes' variations", () => {
      expect(isMetaConversation("yes")).toBe(true);
      expect(isMetaConversation("Yes")).toBe(true);
      expect(isMetaConversation("YES")).toBe(true);
      expect(isMetaConversation("yep")).toBe(true);
      expect(isMetaConversation("yeah")).toBe(true);
    });

    test("detects 'no' variations", () => {
      expect(isMetaConversation("no")).toBe(true);
      expect(isMetaConversation("No")).toBe(true);
      expect(isMetaConversation("NO")).toBe(true);
      expect(isMetaConversation("nope")).toBe(true);
      expect(isMetaConversation("nah")).toBe(true);
    });

    test("detects other short approvals", () => {
      expect(isMetaConversation("ok")).toBe(true);
      expect(isMetaConversation("OK")).toBe(true);
      expect(isMetaConversation("sure")).toBe(true);
      expect(isMetaConversation("Sure")).toBe(true);
    });

    test("allows trailing whitespace", () => {
      expect(isMetaConversation("yes ")).toBe(true);
      expect(isMetaConversation("no  ")).toBe(true);
      expect(isMetaConversation("ok\t")).toBe(true);
    });

    test("rejects approvals with extra content", () => {
      expect(isMetaConversation("yes please")).toBe(false);
      expect(isMetaConversation("no thanks")).toBe(false);
      expect(isMetaConversation("okay then")).toBe(false);
    });
  });

  describe("numbered responses", () => {
    test("detects numbered list items", () => {
      expect(isMetaConversation("1")).toBe(true);
      expect(isMetaConversation("2 ")).toBe(true);
      expect(isMetaConversation("3.")).toBe(true);
      expect(isMetaConversation("42. ")).toBe(true);
    });

    test("detects numbers at start with text", () => {
      expect(isMetaConversation("1 First option")).toBe(true);
      expect(isMetaConversation("2. Second choice")).toBe(true);
      expect(isMetaConversation("3 something else")).toBe(true);
    });

    test("rejects numbers not at start", () => {
      expect(isMetaConversation("Option 1")).toBe(false);
      expect(isMetaConversation("There are 3 options")).toBe(false);
    });
  });

  describe("questions to assistant", () => {
    test("detects 'what' questions", () => {
      expect(isMetaConversation("what is this?")).toBe(true);
      expect(isMetaConversation("What should I do?")).toBe(true);
      expect(isMetaConversation("WHAT are the options?")).toBe(true);
    });

    test("detects 'why' questions", () => {
      expect(isMetaConversation("why did this happen?")).toBe(true);
      expect(isMetaConversation("Why not?")).toBe(true);
    });

    test("detects 'how' questions", () => {
      expect(isMetaConversation("how do I do this?")).toBe(true);
      expect(isMetaConversation("How should I proceed?")).toBe(true);
    });

    test("detects 'when/where/who' questions", () => {
      expect(isMetaConversation("when should I run this?")).toBe(true);
      expect(isMetaConversation("where is the file?")).toBe(true);
      expect(isMetaConversation("who created this?")).toBe(true);
    });

    test("detects 'can you' requests", () => {
      expect(isMetaConversation("can you help me?")).toBe(true);
      expect(isMetaConversation("Can you explain this?")).toBe(true);
    });

    test("detects 'could you' requests", () => {
      expect(isMetaConversation("could you show me?")).toBe(true);
      expect(isMetaConversation("Could you check this?")).toBe(true);
    });

    test("detects 'would you' requests", () => {
      expect(isMetaConversation("would you mind?")).toBe(true);
      expect(isMetaConversation("Would you prefer?")).toBe(true);
    });

    test("detects 'do you' questions", () => {
      expect(isMetaConversation("do you understand?")).toBe(true);
      expect(isMetaConversation("Do you know?")).toBe(true);
    });

    test("rejects questions not at start", () => {
      expect(isMetaConversation("I wonder what this is")).toBe(false);
      expect(isMetaConversation("Tell me how to do this")).toBe(false);
    });
  });

  describe("meta-discussion phrases", () => {
    test("detects 'what do you think'", () => {
      expect(isMetaConversation("what do you think?")).toBe(true);
      expect(isMetaConversation("What do you think about this?")).toBe(true);
      expect(isMetaConversation("So what do you think we should do?")).toBe(true);
    });

    test("detects 'your thoughts'", () => {
      expect(isMetaConversation("your thoughts?")).toBe(true);
      expect(isMetaConversation("What are your thoughts?")).toBe(true);
      expect(isMetaConversation("I'd like your thoughts on this")).toBe(true);
    });

    test("detects 'any ideas'", () => {
      expect(isMetaConversation("any ideas?")).toBe(true);
      expect(isMetaConversation("Do you have any ideas?")).toBe(true);
      expect(isMetaConversation("Looking for any ideas here")).toBe(true);
    });

    test("detects 'suggestions'", () => {
      expect(isMetaConversation("suggestions?")).toBe(true);
      expect(isMetaConversation("Any suggestions?")).toBe(true);
      expect(isMetaConversation("I need suggestions for this")).toBe(true);
    });

    test("detects 'recommend'", () => {
      expect(isMetaConversation("what would you recommend?")).toBe(true);
      expect(isMetaConversation("Do you recommend this approach?")).toBe(true);
      expect(isMetaConversation("I'd like to know what you recommend")).toBe(true);
    });
  });

  describe("non-meta messages", () => {
    test("rejects clear task requests", () => {
      expect(isMetaConversation("Create a new file")).toBe(false);
      expect(isMetaConversation("Fix the bug in auth.ts")).toBe(false);
      expect(isMetaConversation("Refactor the database module")).toBe(false);
    });

    test("rejects technical descriptions", () => {
      expect(isMetaConversation("The function returns null")).toBe(false);
      expect(isMetaConversation("Add error handling to the parser")).toBe(false);
      expect(isMetaConversation("Update the tests to cover edge cases")).toBe(false);
    });

    test("rejects imperative commands", () => {
      expect(isMetaConversation("Run the tests")).toBe(false);
      expect(isMetaConversation("Install dependencies")).toBe(false);
      expect(isMetaConversation("Commit the changes")).toBe(false);
    });

    test("rejects longer descriptive text", () => {
      expect(isMetaConversation("I need to implement a new feature for user authentication")).toBe(false);
      expect(isMetaConversation("The application should handle errors gracefully")).toBe(false);
      expect(isMetaConversation("Let's add support for multiple file formats")).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("handles mixed case", () => {
      expect(isMetaConversation("YeS")).toBe(true);
      expect(isMetaConversation("WhAt Is ThIs?")).toBe(true);
    });

    test("handles punctuation", () => {
      expect(isMetaConversation("yes.")).toBe(false); // Has extra content
      expect(isMetaConversation("what?")).toBe(true);
      expect(isMetaConversation("what!")).toBe(true);
    });

    test("handles leading whitespace", () => {
      expect(isMetaConversation("  yes")).toBe(true);
      expect(isMetaConversation("\twhat is this?")).toBe(true);
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
    test("builds index from skills", () => {
      const index = buildSkillSearchIndex(sampleSkills);
      expect(index).toBeDefined();
      expect(index.documentCount).toBe(5);
    });

    test("builds empty index from empty skills", () => {
      const index = buildSkillSearchIndex([]);
      expect(index).toBeDefined();
      expect(index.documentCount).toBe(0);
    });

    test("indexes skill names and descriptions", () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const results = index.search("git");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.name).toBe("git-helper");
    });
  });

  describe("querySkillIndex", () => {
    test("returns relevant results for query", () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const matches = querySkillIndex(index, "git workflow", 5, 0);
      
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]?.name).toBe("git-helper");
      expect(matches[0]?.score).toBeGreaterThan(0);
    });

    test("respects score threshold", () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const highThreshold = 10; // Very high threshold
      const matches = querySkillIndex(index, "git", 5, highThreshold);
      
      // All results should have score >= threshold
      matches.forEach((match) => {
        expect(match.score).toBeGreaterThanOrEqual(highThreshold);
      });
    });

    test("respects topK limit", () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const topK = 2;
      const matches = querySkillIndex(index, "design", topK, 0);
      
      expect(matches.length).toBeLessThanOrEqual(topK);
    });

    test("returns empty array when no matches above threshold", () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const matches = querySkillIndex(index, "xyzabc123", 5, 0.1);
      
      expect(matches).toEqual([]);
    });

    test("includes score in results", () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const matches = querySkillIndex(index, "pdf", 5, 0);
      
      expect(matches.length).toBeGreaterThan(0);
      expect(typeof matches[0]?.score).toBe("number");
      expect(matches[0]?.score).toBeGreaterThan(0);
    });

    test("matches by description content", () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const matches = querySkillIndex(index, "extracting text", 5, 0);
      
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]?.name).toBe("pdf");
    });

    test("fuzzy matching works for typos", () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const matches = querySkillIndex(index, "bramstorming", 5, 0); // typo: brainstorming
      
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some((m) => m.name === "brainstorming")).toBe(true);
    });

    test("returns results sorted by score descending", () => {
      const index = buildSkillSearchIndex(sampleSkills);
      const matches = querySkillIndex(index, "design", 5, 0);
      
      // Scores should be in descending order
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i - 1]!.score).toBeGreaterThanOrEqual(matches[i]!.score);
      }
    });
  });

  describe("getOrBuildIndex", () => {
    test("builds index on first call", () => {
      const index = getOrBuildIndex(sampleSkills);
      expect(index).toBeDefined();
      expect(index.documentCount).toBe(5);
    });

    test("returns cached index for same skills", () => {
      const index1 = getOrBuildIndex(sampleSkills);
      const index2 = getOrBuildIndex(sampleSkills);
      
      // Should be the exact same object reference (cached)
      expect(index1).toBe(index2);
    });

    test("rebuilds index when skills change", () => {
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

    test("cache invalidates when skill descriptions change", () => {
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

    test("cache remains valid for identical skills in different order", () => {
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
    test("end-to-end: build index and query for relevant skills", () => {
      const index = getOrBuildIndex(sampleSkills);
      const matches = querySkillIndex(index, "I need help with git commits", 3, 0);
      
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]?.name).toBe("git-helper");
    });

    test("end-to-end: query for PDF manipulation", () => {
      const index = getOrBuildIndex(sampleSkills);
      const matches = querySkillIndex(index, "extract tables from PDF files", 3, 0);
      
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]?.name).toBe("pdf");
    });

    test("end-to-end: query for design work", () => {
      const index = getOrBuildIndex(sampleSkills);
      const matches = querySkillIndex(index, "create frontend interface design", 3, 0);
      
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
    test("returns matched: false for 'yes' approval", () => {
      const result = matchSkills("yes", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for 'no' approval", () => {
      const result = matchSkills("no", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for numbered response", () => {
      const result = matchSkills("1", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for question to assistant", () => {
      const result = matchSkills("what should I do?", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for meta-discussion", () => {
      const result = matchSkills("what do you think?", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for empty message", () => {
      const result = matchSkills("", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });
  });

  describe("task request matching", () => {
    test("matches git-related tasks", () => {
      const result = matchSkills("Help me create a new branch and commit my changes", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("git-helper");
      expect(result.reason).toBe("Matched via local search");
    });

    test("matches PDF tasks", () => {
      const result = matchSkills("Extract tables from this PDF document", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("pdf");
      expect(result.reason).toBe("Matched via local search");
    });

    test("matches document editing tasks", () => {
      const result = matchSkills("Edit this Word document and track changes", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("docx");
      expect(result.reason).toBe("Matched via local search");
    });

    test("matches brainstorming tasks", () => {
      const result = matchSkills("Help me refine this rough idea into a design", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("brainstorming");
      expect(result.reason).toBe("Matched via local search");
    });

    test("matches frontend design tasks", () => {
      const result = matchSkills("Create a production-grade user interface", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("frontend-design");
      expect(result.reason).toBe("Matched via local search");
    });
  });

  describe("multiple skill matching", () => {
    test("can match multiple skills for complex tasks", () => {
      const result = matchSkills("Design a frontend interface and help me brainstorm ideas", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      // At least one skill should match
      expect(result.skills.some((s) => s === "frontend-design" || s === "brainstorming")).toBe(true);
      expect(result.reason).toBe("Matched via local search");
    });

    test("returns at most 5 skills (respects topK limit)", () => {
      const manySkills: SkillSummary[] = Array.from({ length: 20 }, (_, i) => ({
        name: `skill-${i}`,
        description: "Test skill for matching testing purposes",
      }));
      
      const result = matchSkills("testing", manySkills);
      
      if (result.matched) {
        expect(result.skills.length).toBeLessThanOrEqual(5);
      }
    });
  });

  describe("edge cases", () => {
    test("returns no skills available when skill list is empty", () => {
      const result = matchSkills("Help me with git", []);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("No skills available");
    });

    test("returns no relevant skills for unrelated topics", () => {
      const result = matchSkills("xyzabc123qwerty456", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("No relevant skills found");
    });

    test("handles very long messages", () => {
      const longMessage = "Create a frontend interface ".repeat(100);
      const result = matchSkills(longMessage, sampleSkills);
      
      // Should still work with long messages
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
    });

    test("handles messages with special characters", () => {
      const result = matchSkills("Help me with git! @#$%^&*()", sampleSkills);
      
      // Should still match despite special characters
      expect(result.matched).toBe(true);
      expect(result.skills).toContain("git-helper");
    });

    test("preserves MatchResult structure", () => {
      const result = matchSkills("Help with git", sampleSkills);
      
      expect(result).toHaveProperty("matched");
      expect(result).toHaveProperty("skills");
      expect(result).toHaveProperty("reason");
      expect(typeof result.matched).toBe("boolean");
      expect(Array.isArray(result.skills)).toBe(true);
      expect(typeof result.reason).toBe("string");
    });
  });

  describe("integration with heuristic gate", () => {
    test("heuristic gate takes precedence over search", () => {
      // "yes" is a meta-conversation, even though it might match some skills
      const result = matchSkills("yes", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.reason).toBe("Meta-conversation detected");
      // Should not have performed search
      expect(result.skills).toEqual([]);
    });

    test("passes non-meta messages to search", () => {
      const result = matchSkills("Fix the bug", sampleSkills);
      
      // Not a meta-conversation, so should attempt search
      expect(result.reason).not.toBe("Meta-conversation detected");
    });
  });

  describe("consistency with original behavior", () => {
    test("returns empty skills array when no match (like makePreflightCallWithTimeout)", () => {
      const result = matchSkills("completely unrelated query xyz123", sampleSkills);
      
      expect(result.skills).toEqual([]);
    });

    test("returns skill names as strings", () => {
      const result = matchSkills("Help with git", sampleSkills);
      
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
    test("returns matched: false for 'yes' approval", () => {
      const result = matchSkills("yes", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for 'no' approval", () => {
      const result = matchSkills("no", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for numbered response", () => {
      const result = matchSkills("1", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for question to assistant", () => {
      const result = matchSkills("what should I do?", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for meta-discussion", () => {
      const result = matchSkills("what do you think?", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });

    test("returns matched: false for empty message", () => {
      const result = matchSkills("", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("Meta-conversation detected");
    });
  });

  describe("task request matching", () => {
    test("matches git-related tasks", () => {
      const result = matchSkills("Help me create a new branch and commit my changes", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("git-helper");
      expect(result.reason).toBe("Matched via local search");
    });

    test("matches PDF tasks", () => {
      const result = matchSkills("Extract tables from this PDF document", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("pdf");
      expect(result.reason).toBe("Matched via local search");
    });

    test("matches document editing tasks", () => {
      const result = matchSkills("Edit this Word document and track changes", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("docx");
      expect(result.reason).toBe("Matched via local search");
    });

    test("matches brainstorming tasks", () => {
      const result = matchSkills("Help me refine this rough idea into a design", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("brainstorming");
      expect(result.reason).toBe("Matched via local search");
    });

    test("matches frontend design tasks", () => {
      const result = matchSkills("Create a production-grade user interface", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills).toContain("frontend-design");
      expect(result.reason).toBe("Matched via local search");
    });
  });

  describe("multiple skill matching", () => {
    test("can match multiple skills for complex tasks", () => {
      const result = matchSkills("Design a frontend interface and help me brainstorm ideas", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills.some((s) => s === "frontend-design" || s === "brainstorming")).toBe(true);
      expect(result.reason).toBe("Matched via local search");
    });

    test("returns at most 5 skills (respects topK limit)", () => {
      const manySkills: SkillSummary[] = Array.from({ length: 20 }, (_, i) => ({
        name: `skill-${i}`,
        description: "Test skill for matching testing purposes",
      }));
      
      const result = matchSkills("testing", manySkills);
      
      if (result.matched) {
        expect(result.skills.length).toBeLessThanOrEqual(5);
      }
    });
  });

  describe("edge cases", () => {
    test("returns no skills available when skill list is empty", () => {
      const result = matchSkills("Help me with git", []);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("No skills available");
    });

    test("returns no relevant skills for unrelated topics", () => {
      const result = matchSkills("xyzabc123qwerty456", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.reason).toBe("No relevant skills found");
    });

    test("handles very long messages", () => {
      const longMessage = "Create a frontend interface ".repeat(100);
      const result = matchSkills(longMessage, sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
    });

    test("handles messages with special characters", () => {
      const result = matchSkills("Help me with git! @#$%^&*()", sampleSkills);
      
      expect(result.matched).toBe(true);
      expect(result.skills).toContain("git-helper");
    });

    test("preserves MatchResult structure", () => {
      const result = matchSkills("Help with git", sampleSkills);
      
      expect(result).toHaveProperty("matched");
      expect(result).toHaveProperty("skills");
      expect(result).toHaveProperty("reason");
      expect(typeof result.matched).toBe("boolean");
      expect(Array.isArray(result.skills)).toBe(true);
      expect(typeof result.reason).toBe("string");
    });
  });

  describe("integration with heuristic gate", () => {
    test("heuristic gate takes precedence over search", () => {
      const result = matchSkills("yes", sampleSkills);
      
      expect(result.matched).toBe(false);
      expect(result.reason).toBe("Meta-conversation detected");
      expect(result.skills).toEqual([]);
    });

    test("passes non-meta messages to search", () => {
      const result = matchSkills("Fix the bug", sampleSkills);
      
      expect(result.reason).not.toBe("Meta-conversation detected");
    });
  });

  describe("consistency with original behavior", () => {
    test("returns empty skills array when no match", () => {
      const result = matchSkills("completely unrelated query xyz123", sampleSkills);
      
      expect(result.skills).toEqual([]);
    });

    test("returns skill names as strings", () => {
      const result = matchSkills("Help with git", sampleSkills);
      
      if (result.skills.length > 0) {
        result.skills.forEach((skill) => {
          expect(typeof skill).toBe("string");
        });
      }
    });
  });
});
