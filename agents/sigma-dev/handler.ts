// agents/sigma-dev/handler.ts
// Sigma Dev - controlled development agent.
// Slice 2d: advisor/planner - generates code, docs, scaffolds, refactors.
//
// CRITICAL RULES:
// - Sigma Dev NEVER writes to disk directly.
// - All proposed artifacts require human approval via requestApproval().
// - Shell execution, git operations, and autonomous loops are prohibited.
// - LLM is used for reasoning/generation only.
// - All file mutations are runtime-controlled after explicit approval.

import { requestApproval, Approval } from '../../core/policies/index.js';
import { memSet } from '../../core/memory/index.js';
import { generateResponse } from '../../core/llm/index.js';
import type { Task } from '../../core/router/index.js';

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export type DevAction =
  | 'generate_code'
  | 'scaffold_file'
  | 'write_docs'
  | 'explain_code'
  | 'refactor_code'
  | 'analyze_repo';

// A proposed file or content artifact - stored in memory and approval payload.
// Nothing is written to disk until a human approves.
export interface DevArtifact {
  action: DevAction;
  filePath?: string;       // target path (for generate_code, scaffold_file, write_docs, refactor_code)
  content: string;         // generated content (code, docs, explanation, analysis)
  description: string;     // human-readable summary of what this artifact does
  language?: string;       // e.g. 'typescript', 'markdown', 'json'
  generatedAt: string;
  requiresWrite: boolean;  // false for explain/analyze (read-only outputs)
}

export interface SigmaDevResult {
  status: 'pending_approval' | 'complete' | 'error';
  data: Record<string, unknown>;
  approvalId?: string;
}

// -------------------------------------------------------------------------
// System prompts per action - scoped, deterministic instructions
// -------------------------------------------------------------------------

const SYSTEM_PROMPTS: Record<DevAction, string> = {
  generate_code: `You are Sigma Dev, a software engineering assistant.
Generate clean, production-quality code based on the specification provided.
Output ONLY the code - no prose, no markdown fences, no explanation.
Follow TypeScript best practices. Use ESM imports. No hardcoded secrets.`,

  scaffold_file: `You are Sigma Dev, a software engineering assistant.
Generate a complete file scaffold based on the specification.
Output ONLY the file content - no prose, no markdown fences.
Include necessary imports, type definitions, and placeholder implementations.`,

  write_docs: `You are Sigma Dev, a documentation assistant.
Write clear, accurate technical documentation in Markdown.
Output ONLY the Markdown content - no additional prose.`,

  explain_code: `You are Sigma Dev, a code analysis assistant.
Provide a clear, structured explanation of the provided code.
Focus on: purpose, key logic, data flow, and potential concerns.
Be concise and factual.`,

  refactor_code: `You are Sigma Dev, a code quality assistant.
Analyze the provided code and produce a refactored version.
Output ONLY the refactored code - no prose, no markdown fences.
Preserve all existing behavior. Improve: readability, type safety, performance.`,

  analyze_repo: `You are Sigma Dev, a software architecture assistant.
Analyze the provided repository context and produce a structured report.
Cover: architecture patterns, dependencies, potential improvements, risks.
Output in Markdown format.`,
};

// Actions that produce read-only output (no approval needed for write)
const READ_ONLY_ACTIONS = new Set<DevAction>(['explain_code', 'analyze_repo']);

// -------------------------------------------------------------------------
// Handler
// -------------------------------------------------------------------------

export async function handleTask(task: Task): Promise<SigmaDevResult> {
  console.log(`[sigma-dev] received task=${task.id} type=${task.type}`);

  if (task.type !== 'dev_task') {
    return {
      status: 'error',
      data: { message: `sigma-dev does not handle task type: ${task.type}` },
    };
  }

  const { action, filePath, spec, code, language } = task.payload as {
    action?: string;
    filePath?: string;
    spec?: string;
    code?: string;
    language?: string;
  };

  // Validate action
  const validActions: DevAction[] = [
    'generate_code', 'scaffold_file', 'write_docs',
    'explain_code', 'refactor_code', 'analyze_repo',
  ];
  if (!action || !validActions.includes(action as DevAction)) {
    return {
      status: 'error',
      data: {
        message: `dev_task requires action to be one of: ${validActions.join(', ')}`,
        received: action,
      },
    };
  }

  // Validate inputs per action
  if (['generate_code', 'scaffold_file', 'write_docs'].includes(action) && !filePath) {
    return {
      status: 'error',
      data: { message: `action '${action}' requires filePath` },
    };
  }
  if (['explain_code', 'refactor_code'].includes(action) && !code) {
    return {
      status: 'error',
      data: { message: `action '${action}' requires code` },
    };
  }
  if (!spec && action !== 'explain_code' && action !== 'refactor_code' && action !== 'analyze_repo') {
    return {
      status: 'error',
      data: { message: `action '${action}' requires spec` },
    };
  }

  const devAction = action as DevAction;
  const systemPrompt = SYSTEM_PROMPTS[devAction];

  // Build the user prompt from the task payload
  let userPrompt = '';
  if (spec) userPrompt += `Specification:\n${spec}\n\n`;
  if (filePath) userPrompt += `Target file: ${filePath}\n\n`;
  if (code) userPrompt += `Code to process:\n${code}\n\n`;
  if (language) userPrompt += `Language: ${language}\n\n`;

  // -------------------------------------------------------------------------
  // LLM reasoning - generate the artifact
  // -------------------------------------------------------------------------
  let generatedContent = '';
  let llmDescription = `${devAction} for ${filePath ?? 'provided code'}`;

  try {
    const llmRes = await generateResponse({
      systemPrompt,
      userPrompt: userPrompt.trim(),
      context: { taskId: task.id, action: devAction, filePath, language },
    });
    generatedContent = llmRes.content;
    console.log(`[sigma-dev] llm ok action=${devAction} tokens=${llmRes.usage.totalTokens} latency=${llmRes.latencyMs}ms`);
  } catch (err) {
    console.error(`[sigma-dev] llm failed: ${(err as Error).message}`);
    return {
      status: 'error',
      data: { message: `LLM generation failed: ${(err as Error).message}` },
    };
  }

  // -------------------------------------------------------------------------
  // Build the proposed artifact
  // -------------------------------------------------------------------------
  const artifact: DevArtifact = {
    action: devAction,
    filePath,
    content: generatedContent,
    description: llmDescription,
    language,
    generatedAt: new Date().toISOString(),
    requiresWrite: !READ_ONLY_ACTIONS.has(devAction),
  };

  // -------------------------------------------------------------------------
  // Read-only actions (explain_code, analyze_repo) - complete immediately
  // No write approval needed, just log to memory for audit
  // -------------------------------------------------------------------------
  if (!artifact.requiresWrite) {
    memSet('sigma-dev', `artifact:${task.id}`, artifact, 'sigma-dev');
    console.log(`[sigma-dev] read-only action=${devAction} complete task=${task.id}`);
    return {
      status: 'complete',
      data: { artifact },
    };
  }

  // -------------------------------------------------------------------------
  // Write actions - store artifact in memory, queue for human approval
  // NEVER write to disk here - runtime executes after approval
  // -------------------------------------------------------------------------
  memSet('sigma-dev', `artifact:${task.id}`, artifact, 'sigma-dev');

  const approvalDescription =
    `[${devAction.toUpperCase()}] ${filePath ?? 'code artifact'}: ${spec?.slice(0, 80) ?? '(no spec)'}`;

  const approval: Approval = requestApproval(
    'sigma-dev',
    devAction,
    approvalDescription,
    { taskId: task.id, artifact },
  );

  console.log(`[sigma-dev] approval queued id=${approval.id} action=${devAction} file=${filePath ?? 'none'}`);

  return {
    status: 'pending_approval',
    data: { artifact },
    approvalId: approval.id,
  };
}
