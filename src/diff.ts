import { Codex } from "@openai/codex-sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as fs from "fs/promises";
import { execaCommand } from "execa";

const DiffIssueSchema = z.object({
  file: z.string().describe("File path"),
  line_range: z.string().optional().describe("Line range affected (e.g., '45-52')"),
  type: z.enum(["bug", "security", "performance", "style", "suggestion"]).describe("Issue type"),
  severity: z.enum(["blocker", "critical", "major", "minor", "info"]).describe("Severity"),
  message: z.string().describe("Description of the issue"),
  recommendation: z.string().describe("Recommended action"),
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

    const prompt = `You are an expert code reviewer analyzing a git diff. Review the following changes and provide a comprehensive analysis:

\`\`\`diff
${diff}
\`\`\`

Please analyze:
1. Potential bugs or logic errors in the changes
2. Security vulnerabilities introduced
3. Performance implications
4. Code style and best practices
5. Test coverage (if tests are included)
6. Breaking changes or API changes

Provide:
- Overall assessment
- Whether the changes should be merged
- Specific issues found with severity levels
- Positive notes about good practices
- Test coverage assessment

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
                     issue.severity === "major" ? "🟠" : 
                     issue.severity === "minor" ? "🟡" : "ℹ️";
        console.log(`\n${i + 1}. ${icon} [${issue.severity.toUpperCase()}] ${issue.type}`);
        console.log(`   File: ${issue.file}${issue.line_range ? ` (lines ${issue.line_range})` : ""}`);
        console.log(`   ${issue.message}`);
        console.log(`   💡 ${issue.recommendation}`);
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
