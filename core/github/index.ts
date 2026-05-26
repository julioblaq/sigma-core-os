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
  closed_at?: string | null;
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
  closed_at?: string | null;
  merged_at?: string | null;
  state?: string;
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

type JulesStatus = 'waiting' | 'ready_for_review' | 'completed';

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

export function buildJulesWork(issues: GitHubIssue[], pullRequests: GitHubPullRequest[]) {
  const julesIssues = issues.filter(isJulesIssue);
  const openPrs = filterJulesPullRequests(
    julesIssues,
    pullRequests.filter(pr => pr.state?.toLowerCase() === 'open'),
  );
  const mergedPrs = filterJulesPullRequests(
    julesIssues,
    pullRequests.filter(pr => Boolean(pr.merged_at)),
  );

  const mapIssue = (issue: GitHubIssue, status: JulesStatus) => ({
    id: issue.id,
    title: issue.title,
    url: issue.html_url,
    number: issue.number,
    createdAt: issue.created_at,
    completedAt: issue.closed_at,
    labels: issue.labels?.map(label => label.name).filter((name): name is string => Boolean(name)) ?? [],
    status,
  });
  const mapPullRequest = (pr: GitHubPullRequest, status: JulesStatus) => ({
    id: pr.id,
    title: pr.title,
    url: pr.html_url,
    number: pr.number,
    createdAt: pr.created_at,
    completedAt: pr.merged_at,
    user: pr.user?.login,
    labels: pr.labels?.map(label => label.name).filter((name): name is string => Boolean(name)) ?? [],
    status,
  });

  const openIssues = julesIssues
    .filter(issue => issue.state?.toLowerCase() === 'open')
    .map(issue => mapIssue(
      issue,
      openPrs.some(pr => referencesTask(pr, issue.number)) ? 'ready_for_review' : 'waiting',
    ));

  const recentlyCompleted = [
    ...julesIssues
      .filter(issue => issue.state?.toLowerCase() === 'closed')
      .map(issue => ({ ...mapIssue(issue, 'completed'), kind: 'Issue' as const })),
    ...mergedPrs.map(pr => ({ ...mapPullRequest(pr, 'completed'), kind: 'PR' as const })),
  ]
    .filter(item => Boolean(item.completedAt))
    .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime())
    .slice(0, 10);

  return {
    issues: openIssues,
    pullRequests: openPrs.map(pr => mapPullRequest(pr, 'ready_for_review')),
    recentlyCompleted,
  };
}
