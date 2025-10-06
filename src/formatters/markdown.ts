export interface MarkdownIssue {
  file: string;
  line_range?: string;
  type: string;
  severity: string;
  issue: string;
}

export interface MarkdownSummary {
  overall_assessment: string;
  should_merge: boolean;
  issues: MarkdownIssue[];
  positive_notes?: string[];
}

export function convertToMarkdown(summary: MarkdownSummary): string {
  const lines: string[] = [];
  
  lines.push("# Code Review Summary");
  lines.push("");
  
  // Status badge
  const badge = summary.should_merge 
    ? "✅ **APPROVED**" 
    : "⚠️ **NEEDS WORK**";
  lines.push(badge);
  lines.push("");
  
  // Assessment
  lines.push("## Overall Assessment");
  lines.push(summary.overall_assessment);
  lines.push("");
  
  // Statistics
  const stats = {
    blocker: 0,
    critical: 0,
    major: 0,
    minor: 0,
    other: 0,
  };
  
  for (const issue of summary.issues) {
    const sev = issue.severity.toLowerCase();
    if (sev in stats) {
      stats[sev as keyof typeof stats]++;
    } else {
      stats.other++;
    }
  }
  
  lines.push("## Statistics");
  lines.push(`- **Total Issues**: ${summary.issues.length}`);
  if (stats.blocker > 0) lines.push(`- 🔴 **Blocker**: ${stats.blocker}`);
  if (stats.critical > 0) lines.push(`- 🔴 **Critical**: ${stats.critical}`);
  if (stats.major > 0) lines.push(`- 🟠 **Major**: ${stats.major}`);
  if (stats.minor > 0) lines.push(`- 🟡 **Minor**: ${stats.minor}`);
  lines.push("");
  
  // Issues table
  if (summary.issues.length > 0) {
    lines.push("## Issues Found");
    lines.push("");
    lines.push("| Severity | Type | File | Issue |");
    lines.push("|----------|------|------|-------|");
    
    for (const issue of summary.issues.slice(0, 20)) {
      const icon = getSeverityIcon(issue.severity);
      const fileRef = issue.line_range 
        ? `${issue.file}:${issue.line_range}`
        : issue.file;
      const issueText = issue.issue.replace(/\|/g, "\\|").substring(0, 80);
      
      lines.push(`| ${icon} ${issue.severity} | ${issue.type} | \`${fileRef}\` | ${issueText} |`);
    }
    
    if (summary.issues.length > 20) {
      lines.push("");
      lines.push(`... and ${summary.issues.length - 20} more issues.`);
    }
  } else {
    lines.push("## ✨ No Issues Found!");
  }
  
  lines.push("");
  
  // Positive notes
  if (summary.positive_notes && summary.positive_notes.length > 0) {
    lines.push("## 👍 Positive Notes");
    for (const note of summary.positive_notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }
  
  return lines.join("\n");
}

function getSeverityIcon(severity: string): string {
  const s = severity.toLowerCase();
  if (s === "blocker" || s === "critical") return "🔴";
  if (s === "major" || s === "high") return "🟠";
  if (s === "minor" || s === "medium") return "🟡";
  return "ℹ️";
}
