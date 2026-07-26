import { randomUUID } from 'crypto';
import { memList, memSet, requestApproval } from '../store/control.js';
import { buildSigmaDaily, type SigmaDailyReport } from './index.js';
const NAMESPACE = 'sigma-daily-issues';
export interface SigmaDailyIssue { id: string; subject: string; status: 'awaiting_review' | 'ready_to_publish' | 'rejected'; markdown: string; report: SigmaDailyReport; approvalId: string; createdAt: string; feedback?: Array<{ message: string; author: string; createdAt: string }>; }
const isIssue = (value: unknown): value is SigmaDailyIssue => Boolean(value && typeof value === 'object' && typeof (value as SigmaDailyIssue).id === 'string');
export async function listSigmaDailyIssues() { return (await memList(NAMESPACE)).map(entry => entry.value).filter(isIssue).sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
export async function getSigmaDailyIssue(id: string) { return (await listSigmaDailyIssues()).find(item => item.id === id) ?? null; }
export async function createSigmaDailyIssue(input: { watchlist?: string | string[]; requestedBy?: string } = {}) {
  const report = await buildSigmaDaily(input); const id = randomUUID(); const subject = `Sigma Daily: ${new Date(report.generatedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' })}`;
  const markdown = `# Sigma Daily\n\n${report.headline}\n\n## Watchlist\n\n${report.watchlist.map(item => `- **${item.symbol}** $${item.last.toFixed(2)} (${item.changePercent === null ? 'n/a' : `${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%`})`).join('\n')}\n\n## Research\n\n${report.news.map(item => `- [${item.symbol}: ${item.title}](${item.link})`).join('\n')}\n\n---\n*Research and education only; not individualized investment advice.*`;
  const approval = await requestApproval('sigma-daily', 'sigma_daily_issue_review', `Review Sigma Daily draft: ${subject}`, { issueId: id, requestedBy: input.requestedBy ?? 'sigma-daily' });
  const issue: SigmaDailyIssue = { id, subject, status: 'awaiting_review', markdown, report, approvalId: approval.id, createdAt: new Date().toISOString() }; await memSet(NAMESPACE, id, issue, 'sigma-daily'); return issue;
}
export async function addSigmaDailyFeedback(id: string, message: string, author: string) { const issue = await getSigmaDailyIssue(id); if (!issue || !message.trim()) return null; const updated = { ...issue, feedback: [...(issue.feedback ?? []), { message: message.trim().slice(0, 2000), author, createdAt: new Date().toISOString() }] }; await memSet(NAMESPACE, id, updated, 'sigma-daily-feedback'); return updated; }
export async function applySigmaDailyReview(approvalId: string, approved: boolean) { const issue = (await listSigmaDailyIssues()).find(item => item.approvalId === approvalId); if (!issue) return null; const updated = { ...issue, status: approved ? 'ready_to_publish' as const : 'rejected' as const }; await memSet(NAMESPACE, updated.id, updated, 'sigma-daily-review'); return updated; }
