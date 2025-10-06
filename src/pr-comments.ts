import { Codex } from "@openai/codex-sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as fs from "fs/promises";
import { execaCommand } from "execa";

const PRCommentSchema = z.object({
  path: z.string().describe("File path"),
  line: z.number().describe("Line number in the file"),
  body: z.string().describe("Comment body with clear issue description and fix"),
});

const PRReviewSchema = z.object({
  comments: z.array(PRCommentSchema).describe("Array of review comments to post"),
});

type PRReview = z.infer<typeof PRReviewSchema>;

export async function generatePRComments(options: any): Promise<void> {
  console.log("🔍 Generating PR review comments...\n");

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

    const prompt = `You are an automated code review system. Review the PR diff and generate inline review comments for clear issues that need to be fixed.

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

COMMENT FORMAT:
- Clearly describe the issue: "This code block is unreachable due to the if (false) condition"
- Explain why it's a problem: "This will cause a TypeError if input is null"
- Provide a concrete fix: "Remove this entire if block as it will never execute"
- When possible, suggest the exact code change
- Be specific, technical, no emojis

SKIP:
- Code style, formatting, or naming conventions
- Minor performance optimizations
- Architectural decisions or design patterns
- Features or functionality (unless broken)
- Test coverage (unless tests are clearly broken)

OUTPUT:
- Empty array if no issues found
- Otherwise array of comment objects with path, line, body
- Each comment should be actionable and clear about what needs to be fixed
- Prioritize the most critical issues

Return results in the specified JSON schema format.`;

    const schema = zodToJsonSchema(PRReviewSchema, { target: "openAi" });
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
    
    let result: PRReview;
    try {
      result = JSON.parse(finalResponse);
    } catch (e) {
      console.error("Failed to parse response as JSON. Raw response:");
      console.log(finalResponse);
      throw e;
    }

    await fs.writeFile(options.output, JSON.stringify(result.comments, null, 2));
    
    console.log("📊 Review Complete!\n");
    
    if (result.comments.length > 0) {
      console.log(`Found ${result.comments.length} issue(s) to comment on:\n`);
      result.comments.forEach((comment, i) => {
        console.log(`${i + 1}. ${comment.path}:${comment.line}`);
        console.log(`   ${comment.body.split('\n')[0]}`);
        console.log();
      });
    } else {
      console.log("✨ No issues found!");
    }
    
    console.log(`✅ Comments saved to ${options.output}`);
    console.log(`   Use these with GitHub CLI or API to post review comments\n`);
    
    if (usage) {
      console.log(`📈 Token Usage:`);
      console.log(`   Input: ${usage.input_tokens}`);
      console.log(`   Cached: ${usage.cached_input_tokens}`);
      console.log(`   Output: ${usage.output_tokens}`);
    }
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("not a git repository")) {
      console.error("❌ Not a git repository. Please run this command in a git repository.");
    } else {
      console.error("❌ Comment generation failed:", error.message || error);
    }
    process.exit(1);
  }
}
