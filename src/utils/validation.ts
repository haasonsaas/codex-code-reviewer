import * as fs from "fs/promises";
import { execaCommand } from "execa";

export async function validateGitRepo(): Promise<void> {
  try {
    await execaCommand("git rev-parse --git-dir");
  } catch {
    throw new Error("Not a git repository. Please run this command in a git repository.");
  }
}

export async function validateCodexCLI(): Promise<void> {
  try {
    await execaCommand("codex --version");
  } catch {
    throw new Error(
      "Codex CLI not found. Please install it:\n" +
      "  npm install -g @openai/codex\n" +
      "  or\n" +
      "  brew install codex"
    );
  }
}

export async function validatePaths(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await fs.access(path);
    } catch {
      throw new Error(`Path not found: ${path}`);
    }
  }
}

export function validateAPIKey(): void {
  if (!process.env.OPENAI_API_KEY && !process.env.CODEX_API_KEY) {
    throw new Error(
      "API key not found. Please set OPENAI_API_KEY or CODEX_API_KEY environment variable."
    );
  }
}
