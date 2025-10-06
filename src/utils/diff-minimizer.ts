import { execaCommand } from "execa";

export interface DiffOptions {
  branch?: string;
  commit?: string;
}

export async function getMinimizedDiff(options: DiffOptions): Promise<string> {
  let diffCommand: string;
  
  if (options.commit) {
    // Show specific commit with minimal context
    diffCommand = `git show --unified=0 --no-color ${options.commit}`;
  } else {
    // Compare against branch with minimal context
    const branch = options.branch || "main";
    diffCommand = `git diff --unified=0 --no-color ${branch}...HEAD`;
  }

  const { stdout: diff } = await execaCommand(diffCommand);
  return diff.trim();
}

export function chunkDiffByFile(diff: string): Map<string, string> {
  const fileChunks = new Map<string, string>();
  const lines = diff.split("\n");
  
  let currentFile: string | null = null;
  let currentChunk: string[] = [];
  
  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      // Save previous chunk
      if (currentFile && currentChunk.length > 0) {
        fileChunks.set(currentFile, currentChunk.join("\n"));
      }
      
      // Start new chunk
      const match = line.match(/diff --git a\/(.*?) b\/(.*)/);
      currentFile = match ? match[2] : null;
      currentChunk = [line];
    } else if (currentFile) {
      currentChunk.push(line);
    }
  }
  
  // Save last chunk
  if (currentFile && currentChunk.length > 0) {
    fileChunks.set(currentFile, currentChunk.join("\n"));
  }
  
  return fileChunks;
}

export function estimateTokenCount(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

export function isDiffTooLarge(diff: string, maxTokens: number = 20000): boolean {
  return estimateTokenCount(diff) > maxTokens;
}
