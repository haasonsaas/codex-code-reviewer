import { Codex } from "@openai/codex-sdk";
import { z } from "zod";
import * as fs from "fs/promises";
import { runWithSchema } from "./utils/codex-runner.js";
import { validateGitRepo, validateCodexCLI, validateAPIKey } from "./utils/validation.js";
import { getMinimizedDiff, isDiffTooLarge } from "./utils/diff-minimizer.js";
import { getThreadId, saveThreadId, clearOldThreads } from "./utils/thread-cache.js";
import { addFingerprints, filterNewIssues } from "./utils/fingerprint.js";
import { convertToSARIF } from "./formatters/sarif.js";
import { convertToMarkdown } from "./formatters/markdown.js";

const DiffIssueSchema = z.object({
  file: z.string(),
  line_range: z.string().optional(),
  type: z.string(),
  severity: z.string(),
  issue: z.string(),
  why_problem: z.string(),
  fix: z.string(),
});

const DiffAnalysisSchema = z.object({
  overall_assessment: z.string().describe("Overall assessment of the changes"),
  should_merge: z.boolean().describe("Whether changes are safe to merge"),
  issues: z.array(DiffIssueSchema).describe("Issues found in the diff"),
  positive_notes: z.array(z.string()).describe("Good practices observed"),
  test_coverage_notes: z.string().optional().describe("Notes about test coverage"),
});

type DiffAnalysis = z.infer<typeof DiffAnalysisSchema>;

export interface DiffOptions {
  branch?: string;
  commit?: string;
  output: string;
  timeout?: number;
  failOn?: "none" | "minor" | "major" | "critical" | "blocker";
  baseline?: string;
  updateBaseline?: boolean;
  newIssuesOnly?: boolean;
  format?: string[];
  maxIssues?: number;
}

export async function analyzeDiff(options: DiffOptions): Promise<void> {
  console.log("🔍 Analyzing git diff...\n");

  try {
    // Validate environment
    await validateGitRepo();
    await validateCodexCLI();
    validateAPIKey();

    // Clean old thread cache
    await clearOldThreads();

    const diff = await getMinimizedDiff({
      branch: options.branch,
      commit: options.commit,
    });

    if (!diff) {
      console.log("ℹ️  No changes found.");
      return;
    }

    if (isDiffTooLarge(diff)) {
      console.warn("⚠️  Warning: Diff is very large and may exceed token limits.");
      console.warn("   Consider reviewing files individually or in smaller batches.\n");
    }

    const displayInfo = options.commit
      ? `commit ${options.commit}`
      : `branch ${options.branch || "main"}`;
    console.log(`   Analyzing: ${displayInfo}\n`);

    // Thread caching for better performance
    const cacheKey = options.commit || `diff-${options.branch || "main"}`;
    const cachedThreadId = await getThreadId(cacheKey);

    const codex = new Codex();
    const thread = cachedThreadId
      ? codex.resumeThread(cachedThreadId)
      : codex.startThread();

    if (cachedThreadId) {
      console.log("   Using cached thread for better performance\n");
    }

    const prompt = buildPrompt(diff);

    console.log("🤖 Analyzing changes with Codex agent...\n");

    const { data: result, usage } = await runWithSchema(
      thread,
      prompt,
      DiffAnalysisSchema,
      { timeout: options.timeout || 180000 } // 3 minutes default
    );

    // Save thread ID for future reuse
    if (thread.id) {
      await saveThreadId(cacheKey, thread.id);
    }

    // Add fingerprints to issues
    const fingerprintedIssues = addFingerprints(result.issues);
    
    // Handle baseline filtering
    let filteredIssues = fingerprintedIssues;
    if (options.baseline && options.newIssuesOnly) {
      const baseline = await loadBaseline(options.baseline);
      filteredIssues = filterNewIssues(fingerprintedIssues, baseline);
      console.log(`   Filtered to ${filteredIssues.length} new issues (${fingerprintedIssues.length - filteredIssues.length} in baseline)\n`);
    }
    
    // Update baseline if requested
    if (options.updateBaseline && options.baseline) {
      const fingerprints = new Set(fingerprintedIssues.map(i => i.fingerprint));
      await fs.writeFile(
        options.baseline,
        JSON.stringify(Array.from(fingerprints), null, 2)
      );
      console.log(`✅ Baseline updated: ${options.baseline}\n`);
    }
    
    // Apply max issues cap
    if (options.maxIssues && filteredIssues.length > options.maxIssues) {
      console.warn(`⚠️  Capped to ${options.maxIssues} issues (found ${filteredIssues.length})\n`);
      filteredIssues = filteredIssues.slice(0, options.maxIssues);
    }
    
    const finalResult = { ...result, issues: filteredIssues };
    
    // Write outputs in requested formats
    await writeOutputs(finalResult, options);

    displayResults(finalResult, options.output);

    if (usage) {
      console.log(`\n📈 Token Usage:`);
      console.log(`   Input: ${usage.input_tokens}`);
      console.log(`   Cached: ${usage.cached_input_tokens}`);
      console.log(`   Output: ${usage.output_tokens}`);
    }
    
    // Quality gate check
    const shouldFail = checkQualityGate(filteredIssues, result.should_merge, options);
    if (shouldFail) {
      console.log("\n❌ Quality gate FAILED");
      process.exit(2);
    }
    
    console.log("\n✅ Quality gate PASSED");
  } catch (error: any) {
    console.error(`❌ ${error.message || error}`);
    process.exit(1);
  }
}

function buildPrompt(diff: string): string {
  return `Analyze this git diff and identify critical issues. Return ONLY valid JSON.

\`\`\`diff
${diff}
\`\`\`

FOCUS ON:
- Dead code, unreachable code
- Control flow bugs (missing break, incorrect logic)
- Async/await mistakes, promise handling
- Type errors, null/undefined access
- Security: injection, XSS, resource leaks
- Race conditions, missing error handling

FOR EACH ISSUE:
1. What's wrong (concise)
2. Why it's a problem
3. Concrete fix

SKIP: style, naming, minor optimizations, architecture opinions

MERGE DECISION:
- should_merge = false if blocker/critical issues
- should_merge = true only if safe

Return as JSON with: overall_assessment, should_merge, issues[], positive_notes[], test_coverage_notes`;
}

async function loadBaseline(path: string): Promise<Set<string>> {
  try {
    const data = await fs.readFile(path, "utf-8");
    const fingerprints = JSON.parse(data);
    return new Set(fingerprints);
  } catch {
    return new Set();
  }
}

function checkQualityGate(
  issues: any[],
  shouldMerge: boolean,
  options: DiffOptions
): boolean {
  if (!options.failOn || options.failOn === "none") {
    return false;
  }
  
  const severityOrder = ["blocker", "critical", "major", "minor"];
  const threshold = severityOrder.indexOf(options.failOn);
  
  for (const issue of issues) {
    const issueSeverity = severityOrder.indexOf(issue.severity.toLowerCase());
    if (issueSeverity !== -1 && issueSeverity <= threshold) {
      return true; // Has issue at or above threshold
    }
  }
  
  return false;
}

async function writeOutputs(result: DiffAnalysis, options: DiffOptions): Promise<void> {
  const formats = options.format || ["json"];
  
  for (const format of formats) {
    switch (format.toLowerCase()) {
      case "json":
        await fs.writeFile(options.output, JSON.stringify(result, null, 2));
        break;
        
      case "sarif":
        const sarifPath = options.output.replace(/\.json$/, ".sarif");
        const sarif = convertToSARIF(result.issues as any);
        await fs.writeFile(sarifPath, JSON.stringify(sarif, null, 2));
        console.log(`   SARIF: ${sarifPath}`);
        break;
        
      case "markdown":
      case "md":
        const mdPath = options.output.replace(/\.json$/, ".md");
        const markdown = convertToMarkdown(result as any);
        await fs.writeFile(mdPath, markdown);
        console.log(`   Markdown: ${mdPath}`);
        break;
    }
  }
}

function displayResults(result: DiffAnalysis, outputPath: string): void {
  console.log("📊 Analysis Complete!\n");
  console.log(`${result.should_merge ? "✅" : "⚠️"} Merge: ${result.should_merge ? "APPROVE" : "NEEDS WORK"}\n`);
  console.log(`${result.overall_assessment}\n`);

  if (result.issues.length > 0) {
    console.log(`🚨 Issues (${result.issues.length}):`);
    result.issues.forEach((issue, i) => {
      const icon =
        issue.severity === "blocker" || issue.severity === "critical"
          ? "🔴"
          : issue.severity === "major"
          ? "🟠"
          : "🟡";
      console.log(`\n${i + 1}. ${icon} [${issue.severity.toUpperCase()}] ${issue.type}`);
      console.log(`   File: ${issue.file}${issue.line_range ? ` (${issue.line_range})` : ""}`);
      console.log(`   Issue: ${issue.issue}`);
      console.log(`   Why: ${issue.why_problem}`);
      console.log(`   Fix: ${issue.fix}`);
    });
  } else {
    console.log("✨ No issues found!");
  }

  if (result.positive_notes.length > 0) {
    console.log(`\n👍 Positive:`);
    result.positive_notes.forEach((note, i) => {
      console.log(`  ${i + 1}. ${note}`);
    });
  }

  if (result.test_coverage_notes) {
    console.log(`\n🧪 Tests: ${result.test_coverage_notes}`);
  }

  console.log(`\n✅ Saved to ${outputPath}`);
}
