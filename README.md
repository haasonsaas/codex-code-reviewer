# Codex Code Reviewer

AI-powered code review CLI tool built with the OpenAI Codex SDK. Automatically analyze code for bugs, security issues, performance problems, and style violations.

## Features

✨ **Automated Code Reviews** - Review entire codebases or specific files with AI-powered analysis  
🔍 **Git Diff Analysis** - Analyze pull requests and commits before merging  
📊 **Structured Output** - Get detailed JSON reports with severity levels and recommendations  
🎯 **Focus Areas** - Target specific review areas: security, performance, bugs, style  
🚀 **Powered by Codex** - Uses the latest OpenAI Codex agent for intelligent code analysis

## Prerequisites

- Node.js 18 or higher
- OpenAI Codex CLI installed globally:
  ```bash
  npm install -g @openai/codex
  ```

## Installation

```bash
npm install
npm run build
```

Or install globally:

```bash
npm install -g .
```

## Usage

### Review Code

Review files or directories for issues:

```bash
codex-review review [paths...]
```

**Options:**
- `-o, --output <file>` - Output file for results (default: `review-results.json`)
- `--focus <areas>` - Comma-separated focus areas (default: `security,performance,bugs,style`)

**Examples:**

```bash
# Review current directory
codex-review review

# Review specific files
codex-review review src/auth.ts src/api.ts

# Focus on security and performance
codex-review review --focus security,performance

# Save to custom output file
codex-review review -o my-review.json
```

**Output:**

```json
{
  "summary": "Overall code review summary...",
  "issues": [
    {
      "file": "src/auth.ts",
      "line": 45,
      "severity": "critical",
      "category": "security",
      "title": "SQL Injection Vulnerability",
      "description": "User input is directly interpolated into SQL query...",
      "suggestion": "Use parameterized queries or an ORM..."
    }
  ],
  "stats": {
    "total_issues": 12,
    "critical": 1,
    "high": 3,
    "medium": 5,
    "low": 2,
    "info": 1
  }
}
```

### Analyze Git Diff

Analyze changes in commits or branches:

```bash
codex-review diff
```

**Options:**
- `-b, --branch <branch>` - Compare against branch (default: `main`)
- `-c, --commit <sha>` - Analyze specific commit
- `-o, --output <file>` - Output file for results (default: `diff-analysis.json`)

**Examples:**

```bash
# Analyze diff against main branch
codex-review diff

# Analyze diff against develop branch
codex-review diff --branch develop

# Analyze specific commit
codex-review diff --commit abc123

# Save to custom output file
codex-review diff -o pr-analysis.json
```

**Output:**

```json
{
  "overall_assessment": "Changes introduce new authentication features with good test coverage...",
  "should_merge": true,
  "issues": [
    {
      "file": "src/api.ts",
      "line_range": "45-52",
      "type": "security",
      "severity": "major",
      "message": "API endpoint lacks rate limiting",
      "recommendation": "Implement rate limiting middleware"
    }
  ],
  "positive_notes": [
    "Comprehensive test coverage for new features",
    "Good error handling practices"
  ],
  "test_coverage_notes": "All new functions have corresponding unit tests"
}
```

## CI/CD Integration

Use in your CI pipeline to automatically review PRs:

### GitHub Actions

```yaml
name: Code Review

on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install Codex CLI
        run: npm install -g @openai/codex
      
      - name: Install Code Reviewer
        run: |
          npm install -g codex-code-reviewer
      
      - name: Run Code Review
        run: codex-review diff --branch ${{ github.base_ref }}
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      
      - name: Upload Results
        uses: actions/upload-artifact@v3
        with:
          name: code-review-results
          path: diff-analysis.json
```

### GitLab CI

```yaml
code_review:
  image: node:18
  script:
    - npm install -g @openai/codex
    - npm install -g codex-code-reviewer
    - codex-review diff --branch main
  artifacts:
    paths:
      - diff-analysis.json
  only:
    - merge_requests
```

## Configuration

The tool respects the following environment variables:

- `OPENAI_API_KEY` - Your OpenAI API key
- `CODEX_API_KEY` - Alternative to OPENAI_API_KEY
- `OPENAI_BASE_URL` - Custom API endpoint (optional)

## How It Works

This tool uses the OpenAI Codex SDK to:

1. Start a Codex agent thread
2. Provide your code as context
3. Request structured analysis using JSON schemas (via Zod)
4. Parse and format the results

The Codex agent has access to:
- File reading and analysis tools
- Git operations
- Code search capabilities
- Web search for best practices

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run locally
npm run dev -- review src/

# Test
npm test
```

## License

MIT

## Author

Jonathan Haas

## Links

- [OpenAI Codex](https://openai.com/codex/)
- [Codex CLI Documentation](https://developers.openai.com/codex/cli/)
- [GitHub Repository](https://github.com/yourusername/codex-code-reviewer)
