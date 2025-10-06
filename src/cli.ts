#!/usr/bin/env node

import { Command } from "commander";
import { reviewCode } from "./review.js";
import { analyzeDiff } from "./diff.js";
import { generatePRComments } from "./pr-comments.js";

const program = new Command();

program
  .name("codex-review")
  .description("AI-powered code review CLI using OpenAI Codex")
  .version("1.0.0");

program
  .command("review")
  .description("Review code files or directories for issues and improvements")
  .argument("[paths...]", "Files or directories to review", ["."])
  .option("-o, --output <file>", "Output file for review results (JSON)", "review-results.json")
  .option("--focus <areas>", "Focus areas (e.g., security,performance,bugs)", "security,performance,bugs,style")
  .action(async (paths, options) => {
    await reviewCode(paths, options);
  });

program
  .command("diff")
  .description("Analyze git diff or PR changes")
  .option("-b, --branch <branch>", "Compare against branch", "main")
  .option("-c, --commit <sha>", "Analyze specific commit")
  .option("-o, --output <file>", "Output file for analysis results", "diff-analysis.json")
  .option("--fail-on <severity>", "Fail build on severity: none|minor|major|critical|blocker", "none")
  .option("--baseline <file>", "Baseline fingerprints file for filtering known issues")
  .option("--update-baseline", "Update the baseline file with current issues", false)
  .option("--new-issues-only", "Only fail on new issues not in baseline", true)
  .option("--format <formats...>", "Output formats: json, sarif, markdown", ["json"])
  .option("--max-issues <n>", "Maximum number of issues to report", parseInt)
  .option("--timeout <ms>", "Timeout in milliseconds", parseInt, 180000)
  .action(async (options) => {
    await analyzeDiff(options);
  });

program
  .command("pr-comments")
  .description("Generate inline PR review comments for critical issues")
  .option("-b, --branch <branch>", "Compare against branch", "main")
  .option("-c, --commit <sha>", "Analyze specific commit")
  .option("-o, --output <file>", "Output file for comments (JSON)", "pr-comments.json")
  .action(async (options) => {
    await generatePRComments(options);
  });

program.parse();
