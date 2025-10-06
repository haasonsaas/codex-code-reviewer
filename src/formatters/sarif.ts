export interface SarifIssue {
  file: string;
  line_range?: string;
  type: string;
  severity: string;
  issue: string;
  why_problem: string;
  fix: string;
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: {
      uri: string;
    };
    region: {
      startLine: number;
      endLine?: number;
    };
  };
}

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: {
    text: string;
  };
  locations: SarifLocation[];
}

interface SarifRule {
  id: string;
  shortDescription: {
    text: string;
  };
  fullDescription: {
    text: string;
  };
  help: {
    text: string;
  };
  properties: {
    tags: string[];
  };
}

export interface SarifOutput {
  version: "2.1.0";
  $schema: string;
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: SarifRule[];
      };
    };
    results: SarifResult[];
  }>;
}

function severityToLevel(severity: string): "error" | "warning" | "note" {
  const s = severity.toLowerCase();
  if (s === "blocker" || s === "critical") return "error";
  if (s === "major" || s === "high") return "warning";
  return "note";
}

function parseLineRange(lineRange?: string): { start: number; end?: number } {
  if (!lineRange) return { start: 1 };
  
  const match = lineRange.match(/(\d+)(?:-(\d+))?/);
  if (!match) return { start: 1 };
  
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : undefined;
  
  return { start, end };
}

export function convertToSARIF(
  issues: SarifIssue[],
  toolVersion: string = "1.0.0"
): SarifOutput {
  // Group issues by type to create rules
  const ruleMap = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  for (const issue of issues) {
    const ruleId = `CODEX.${issue.type.toUpperCase().replace(/-/g, "_")}`;
    
    // Create rule if not exists
    if (!ruleMap.has(ruleId)) {
      ruleMap.set(ruleId, {
        id: ruleId,
        shortDescription: {
          text: issue.type.replace(/-/g, " "),
        },
        fullDescription: {
          text: issue.why_problem,
        },
        help: {
          text: issue.fix,
        },
        properties: {
          tags: [issue.type, issue.severity],
        },
      });
    }

    // Parse line range
    const { start, end } = parseLineRange(issue.line_range);

    // Create result
    results.push({
      ruleId,
      level: severityToLevel(issue.severity),
      message: {
        text: issue.issue,
      },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: issue.file,
            },
            region: {
              startLine: start,
              ...(end && { endLine: end }),
            },
          },
        },
      ],
    });
  }

  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "Codex Code Reviewer",
            version: toolVersion,
            informationUri: "https://github.com/haasonsaas/codex-code-reviewer",
            rules: Array.from(ruleMap.values()),
          },
        },
        results,
      },
    ],
  };
}
