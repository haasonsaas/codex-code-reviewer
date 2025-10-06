import { Codex } from "@openai/codex-sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as fs from "fs/promises";

const ReviewIssueSchema = z.object({
  file: z.string().describe("File path"),
  line: z.number().optional().describe("Line number if applicable"),
  severity: z.enum(["critical", "high", "medium", "low", "info"]).describe("Issue severity"),
  category: z.enum(["security", "performance", "bug", "style", "best-practice", "maintainability"]).describe("Issue category"),
  title: z.string().describe("Short issue title"),
  description: z.string().describe("Detailed description of the issue"),
  suggestion: z.string().describe("Suggested fix or improvement"),
});

const ReviewResultSchema = z.object({
  summary: z.string().describe("Overall code review summary"),
  issues: z.array(ReviewIssueSchema).describe("List of identified issues"),
  stats: z.object({
    total_issues: z.number(),
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
    info: z.number(),
  }).describe("Issue statistics"),
});

type ReviewResult = z.infer<typeof ReviewResultSchema>;

export async function reviewCode(paths: string[], options: any): Promise<void> {
  console.log("🔍 Starting code review...");
  console.log(`   Paths: ${paths.join(", ")}`);
  console.log(`   Focus areas: ${options.focus}\n`);

  const codex = new Codex();
  const thread = codex.startThread();

  const focusAreas = options.focus.split(",").map((a: string) => a.trim());
  
  const prompt = `You are a senior code reviewer. Please review the code in the following paths: ${paths.join(", ")}

Focus areas: ${focusAreas.join(", ")}

Provide a comprehensive code review including:
1. Security vulnerabilities
2. Performance issues
3. Potential bugs or logic errors
4. Code style and best practices
5. Maintainability concerns

For each issue found, provide:
- File path and line number
- Severity level
- Clear description
- Specific suggestion for improvement

Return the results in the specified JSON schema format.`;

  try {
    const schema = zodToJsonSchema(ReviewResultSchema, { target: "openAi" });
    const schemaPrompt = `${prompt}\n\nIMPORTANT: Return your response as valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}`;
    
    console.log("🤖 Analyzing code with Codex agent...\n");
    
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
    
    let result: ReviewResult;
    try {
      result = JSON.parse(finalResponse);
    } catch (e) {
      console.error("Failed to parse response as JSON. Raw response:");
      console.log(finalResponse);
      throw e;
    }

    await fs.writeFile(options.output, JSON.stringify(result, null, 2));
    
    console.log("📊 Review Complete!\n");
    console.log(`Summary: ${result.summary}\n`);
    console.log(`Statistics:`);
    console.log(`  Total Issues: ${result.stats.total_issues}`);
    console.log(`  Critical: ${result.stats.critical}`);
    console.log(`  High: ${result.stats.high}`);
    console.log(`  Medium: ${result.stats.medium}`);
    console.log(`  Low: ${result.stats.low}`);
    console.log(`  Info: ${result.stats.info}\n`);
    
    if (result.issues.length > 0) {
      console.log(`Top Issues:`);
      result.issues.slice(0, 5).forEach((issue, i) => {
        console.log(`\n${i + 1}. [${issue.severity.toUpperCase()}] ${issue.title}`);
        console.log(`   File: ${issue.file}${issue.line ? `:${issue.line}` : ""}`);
        console.log(`   ${issue.description}`);
        console.log(`   💡 ${issue.suggestion}`);
      });
      
      if (result.issues.length > 5) {
        console.log(`\n... and ${result.issues.length - 5} more issues.`);
      }
    }
    
    console.log(`\n✅ Full results saved to ${options.output}`);
    
    if (usage) {
      console.log(`\n📈 Token Usage:`);
      console.log(`   Input: ${usage.input_tokens}`);
      console.log(`   Cached: ${usage.cached_input_tokens}`);
      console.log(`   Output: ${usage.output_tokens}`);
    }
  } catch (error) {
    console.error("❌ Review failed:", error);
    process.exit(1);
  }
}
