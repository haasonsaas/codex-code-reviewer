import crypto from "crypto";

export interface Fingerprintable {
  file: string;
  line_range?: string;
  type?: string;
  severity?: string;
  issue?: string;
  title?: string;
  description?: string;
}

function normalizeLineRange(range?: string): string {
  if (!range) return "0";
  // Normalize "45-52", "45", etc to consistent format
  return range.replace(/\s/g, "");
}

function normalizeIssueText(text?: string): string {
  if (!text) return "";
  // Remove whitespace variations, normalize to lowercase
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

export function computeFingerprint(issue: Fingerprintable): string {
  const parts = [
    issue.file,
    normalizeLineRange(issue.line_range),
    issue.type || issue.title || "",
    normalizeIssueText(issue.issue || issue.description || ""),
  ];
  
  const data = parts.join("|");
  return crypto.createHash("sha256").update(data).digest("hex").substring(0, 16);
}

export interface FingerprintedIssue extends Fingerprintable {
  fingerprint: string;
}

export function addFingerprints<T extends Fingerprintable>(issues: T[]): (T & FingerprintedIssue)[] {
  return issues.map(issue => ({
    ...issue,
    fingerprint: computeFingerprint(issue),
  }));
}

export function filterNewIssues<T extends FingerprintedIssue>(
  issues: T[],
  baselineFingerprints: Set<string>
): T[] {
  return issues.filter(issue => !baselineFingerprints.has(issue.fingerprint));
}
