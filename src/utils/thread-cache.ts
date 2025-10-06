import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const CACHE_DIR = path.join(os.homedir(), ".codex-reviewer");
const THREAD_CACHE_FILE = path.join(CACHE_DIR, "threads.json");

interface ThreadCache {
  [key: string]: {
    threadId: string;
    lastUsed: number;
  };
}

export async function ensureCacheDir(): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch {
    // Directory already exists
  }
}

export async function loadThreadCache(): Promise<ThreadCache> {
  try {
    const data = await fs.readFile(THREAD_CACHE_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function saveThreadCache(cache: ThreadCache): Promise<void> {
  await ensureCacheDir();
  await fs.writeFile(THREAD_CACHE_FILE, JSON.stringify(cache, null, 2));
}

export async function getThreadId(cacheKey: string): Promise<string | null> {
  const cache = await loadThreadCache();
  const entry = cache[cacheKey];
  
  if (!entry) {
    return null;
  }
  
  // Expire threads older than 24 hours
  const age = Date.now() - entry.lastUsed;
  if (age > 24 * 60 * 60 * 1000) {
    return null;
  }
  
  return entry.threadId;
}

export async function saveThreadId(cacheKey: string, threadId: string): Promise<void> {
  const cache = await loadThreadCache();
  cache[cacheKey] = {
    threadId,
    lastUsed: Date.now(),
  };
  await saveThreadCache(cache);
}

export async function clearOldThreads(): Promise<void> {
  const cache = await loadThreadCache();
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  const updated: ThreadCache = {};
  for (const [key, entry] of Object.entries(cache)) {
    if (now - entry.lastUsed < maxAge) {
      updated[key] = entry;
    }
  }
  
  await saveThreadCache(updated);
}
