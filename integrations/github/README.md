# integrations/github

GitHub integration for Sigma Core OS.

Allows Sigma Dev to interact with GitHub repositories: create issues, open PRs,
read code, and manage branches.

## Status

Phase 1 stub. Implementation planned for Phase 3.

## Planned Features

- Create and read GitHub issues
- Open pull requests (requires human approval before merging)
- Read repository files
- Create branches for feature work
- Commit code changes

## Setup

Create a GitHub Personal Access Token (PAT) with repo scope:

```
GITHUB_TOKEN=ghp_...
```

## Security Rules

- Sigma Dev may NOT merge pull requests without human approval
- Sigma Dev may NOT push directly to main/production branches
- All PR creation is logged to `core/tools` action log
- Token must be stored in environment variables, never in code

## Usage (planned)

```python
from integrations.github import create_issue, create_pr

issue = create_issue(repo="org/repo", title="Bug: ...", body="...")
```
