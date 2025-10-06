import { Codex } from "@openai/codex-sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as fs from "fs/promises";
import { execaCommand } from "execa";

const DiffIssueSchema = z.object({
  file: z.string().describe("File path"),
  line_range: z.string().optional().describe("Line range affected (e.g., '45-52')"),
  type: z.enum([
    "dead-code",
    "control-flow",
    "async-await",
    "mutation-bug",
    "dependency-array",
    "operator-error",
    "off-by-one",
    "type-coercion",
    "null-deref",
    "resource-leak",
    "injection",
    "race-condition",
    "missing-error-handling",
    "security",
    "other"
  ]).describe("Issue type"),
  severity: z.enum(["blocker", "critical", "major", "minor"]).describe("Severity"),
  issue: z.string().describe("Clear description of what's wrong"),
  why_problem: z.string().describe("Why this is a problem"),
  fix: z.string().describe("Concrete fix with exact code change if possible"),
});

const DiffAnalysisSchema = z.object({
  overall_assessment: z.string().describe("Overall assessment of the changes"),
  should_merge: z.boolean().describe("Whether changes are safe to merge"),
  issues: z.array(DiffIssueSchema).describe("Issues found in the diff"),
  positive_notes: z.array(z.string()).describe("Good practices observed"),
  test_coverage_notes: z.string().optional().describe("Notes about test coverage"),
});

type DiffAnalysis = z.infer<typeof DiffAnalysisSchema>;

export async function analyzeDiff(options: any): Promise<void> {
  console.log("🔍 Analyzing git diff...\n");

  let diffCommand: string;
  
  if (options.commit) {
    diffCommand = `git show ${options.commit}`;
    console.log(`   Analyzing commit: ${options.commit}`);
  } else {
    diffCommand = `git diff ${options.branch}...HEAD`;
    console.log(`   Comparing against: ${options.branch}`);
  }

  try {
    const { stdout: diff } = await execaCommand(diffCommand);
    
    if (!diff.trim()) {
      console.log("ℹ️  No changes found.");
      return;
    }

    const codex = new Codex();
    const thread = codex.startThread();

    const prompt = `You are an automated code review system. Review the PR diff and identify ONLY clear, actionable issues that need to be fixed.

\`\`\`diff
${diff}
\`\`\`

FOCUS ON THESE CRITICAL ISSUES:
- Dead/unreachable code (if (false), while (false), code after return/throw/break)
- Broken control flow (missing break in switch, fallthrough bugs)
- Async/await mistakes (missing await, .then without return, unhandled promise rejections)
- Array/object mutations in React components or reducers
- UseEffect dependency array problems (missing deps, incorrect deps)
- Incorrect operator usage (== vs ===, && vs ||, = in conditions)
- Off-by-one errors in loops or array indexing
- Integer overflow/underflow in calculations
- Regex catastrophic backtracking vulnerabilities
- Missing base cases in recursive functions
- Incorrect type coercion that changes behavior
- Environment variable access without defaults or validation
- Null/undefined dereferences
- Resource leaks (unclosed files or connections)
- SQL/XSS injection vulnerabilities
- Concurrency/race conditions
- Missing error handling for critical operations

FOR EACH ISSUE:
- Clearly describe what's wrong
- Explain WHY it's a problem (not just that it is)
- Provide a CONCRETE fix with exact code changes
- Be specific, technical, no fluff

SKIP:
- Code style, formatting, or naming conventions
- Minor performance optimizations
- Architectural decisions or design patterns
- Features or functionality (unless broken)
- Test coverage (unless tests are clearly broken)

MERGE DECISION:
- should_merge = false if ANY blocker/critical issues exist
- should_merge = true only if issues are minor/none

Return results in the specified JSON schema format.`;

    const schema = zodToJsonSchema(DiffAnalysisSchema, { target: "openAi" });
    const schemaPrompt = `${prompt}\n\nIMPORTANT: Return your response as valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}`;
    
    console.log("🤖 Analyzing changes with Codex agent...\n");
    
    const { events } = await thread.runStreamed(schemaPrompt);
    
    let finalResponse = "";
    let usage: any = null;
    
    for await (const event of events) {
      if (event.type === "item.completed" && event.item.type === "agent_message") {
        finalResponse = event.item.text;
      } else if (event.type === "turn.completed") {
        usage = event.usage;
      }
    }
    
    let result: DiffAnalysis;
    try {
      result = JSON.parse(finalResponse);
    } catch (e) {
      console.error("Failed to parse response as JSON. Raw response:");
      console.log(finalResponse);
      throw e;
    }

    await fs.writeFile(options.output, JSON.stringify(result, null, 2));
    
    console.log("📊 Analysis Complete!\n");
    console.log(`${result.should_merge ? "✅" : "⚠️"} Merge Recommendation: ${result.should_merge ? "APPROVE" : "NEEDS WORK"}\n`);
    console.log(`Assessment: ${result.overall_assessment}\n`);
    
    if (result.issues.length > 0) {
      console.log(`🚨 Issues Found (${result.issues.length}):`);
      result.issues.forEach((issue, i) => {
        const icon = issue.severity === "blocker" || issue.severity === "critical" ? "🔴" : 
                     issue.severity === "major" ? "🟠" : "🟡";
        console.log(`\n${i + 1}. ${icon} [${issue.severity.toUpperCase()}] ${issue.type}`);
        console.log(`   File: ${issue.file}${issue.line_range ? ` (lines ${issue.line_range})` : ""}`);
        console.log(`   Issue: ${issue.issue}`);
        console.log(`   Why: ${issue.why_problem}`);
        console.log(`   Fix: ${issue.fix}`);
      });
    } else {
      console.log("✨ No issues found!");
    }
    
    if (result.positive_notes.length > 0) {
      console.log(`\n👍 Positive Notes:`);
      result.positive_notes.forEach((note, i) => {
        console.log(`  ${i + 1}. ${note}`);
      });
    }
    
    if (result.test_coverage_notes) {
      console.log(`\n🧪 Test Coverage: ${result.test_coverage_notes}`);
    }
    
    console.log(`\n✅ Full analysis saved to ${options.output}`);
    
    if (usage) {
      console.log(`\n📈 Token Usage:`);
      console.log(`   Input: ${usage.input_tokens}`);
      console.log(`   Cached: ${usage.cached_input_tokens}`);
      console.log(`   Output: ${usage.output_tokens}`);
    }
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("not a git repository")) {
      console.error("❌ Not a git repository. Please run this command in a git repository.");
    } else {
      console.error("❌ Diff analysis failed:", error.message || error);
    }
    process.exit(1);
  }
}
