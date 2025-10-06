#!/usr/bin/env node

import { Command } from "commander";
import { reviewCode } from "./review.js";
import { analyzeDiff } from "./diff.js";

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
  .option("-o, --output <file>", "Output file for analysis results (JSON)", "diff-analysis.json")
  .action(async (options) => {
    await analyzeDiff(options);
  });

program.parse();
