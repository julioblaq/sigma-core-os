// GitHub work classification for the MindLyft dashboard.
// Jules PRs can be authored through the repository owner's account, so the
// linked labeled issue is a stronger signal than the PR author alone.

export interface GitHubLabel {
  name?: string;
}

export interface GitHubIssue {
  id?: number;
  title?: string;
  html_url?: string;
  number: number;
  created_at?: string;
  state?: string;
  labels?: GitHubLabel[];
  pull_request?: unknown;
}

export interface GitHubPullRequest {
  id?: number;
  title?: string;
  html_url?: string;
  number?: number;
  created_at?: string;
  body?: string | null;
  labels?: GitHubLabel[];
  user?: { login?: string };
}

function labelNames(labels: GitHubLabel[] | undefined): string[] {
  return (labels ?? [])
    .map(label => label.name?.toLowerCase())
    .filter((name): name is string => Boolean(name));
}

function referencesTask(pr: GitHubPullRequest, issueNumber: number): boolean {
  const closingReference = new RegExp(
    `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${issueNumber}\\b`,
    'i',
  );
  return closingReference.test(pr.body ?? '');
}

export function isJulesIssue(issue: GitHubIssue): boolean {
  return !issue.pull_request && labelNames(issue.labels).includes('jules');
}

export function filterJulesPullRequests(
  issues: GitHubIssue[],
  pullRequests: GitHubPullRequest[],
): GitHubPullRequest[] {
  const julesTaskNumbers = issues.filter(isJulesIssue).map(issue => issue.number);

  return pullRequests.filter(pr => {
    const labels = labelNames(pr.labels);
    const isJulesAuthor = pr.user?.login?.toLowerCase().includes('jules') ?? false;
    const isLabeledForJules = labels.includes('jules');
    const isLabeledForReview = labels.some(label => label.includes('review'));
    const closesJulesTask = julesTaskNumbers.some(number => referencesTask(pr, number));

    return isJulesAuthor || isLabeledForJules || isLabeledForReview || closesJulesTask;
  });
}
