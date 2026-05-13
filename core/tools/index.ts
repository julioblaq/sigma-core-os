/**
 * core/tools/index.ts
   * Sigma Core OS — Tool Registry
 *
 * All agent tools must be registered here before use.
   * Tool calls are logged and sandboxed.
   */

export interface ToolDefinition {
    name: string;
  description: string;
  allowedAgents: string[]; // which agents can use this tool
  requiresApproval: boolean;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolCallLog {
    toolName: string;
  calledBy: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  calledAt: Date;
  completedAt?: Date;
}

// Tool registry — all tools must be registered here
const toolRegistry: Map<string, ToolDefinition> = new Map();

// Action log — append-only
const toolCallLog: ToolCallLog[] = [];

export function registerTool(tool: ToolDefinition): void {
  toolRegistry.set(tool.name, tool);
  console.log(`[tools] Tool registered: ${tool.name} (approval required: ${tool.requiresApproval})`);
                            }

    export function getTool(name: string): ToolDefinition | undefined {
      return toolRegistry.get(name);
}

export function listTools(): ToolDefinition[] {
  return Array.from(toolRegistry.values());
}

export async function executeTool(
  toolName: string,
  calledBy: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const tool = toolRegistry.get(toolName);

  if (!tool) {
    throw new Error(`[tools] Unknown tool: ${toolName}`);
                                     }

  if (!tool.allowedAgents.includes(calledBy) && !tool.allowedAgents.includes('*')) {
    throw new Error(`[tools] Agent ${calledBy} is not allowed to use tool ${toolName}`);
}

  const logEntry: ToolCallLog = {
    toolName,
    calledBy,
    input,
    calledAt: new Date(),
};

  try {
    const output = await tool.execute(input);
    logEntry.output = output;
    logEntry.completedAt = new Date();
    toolCallLog.push(logEntry);
    console.log(`[tools] ${toolName} executed by ${calledBy} — success`);
    return output;
                          } catch (err) {
    logEntry.error = String(err);
    logEntry.completedAt = new Date();
    toolCallLog.push(logEntry);
    console.error(`[tools] ${toolName} executed by ${calledBy} — error: ${err}`);
    throw err;
                            }
}

export function getToolCallLog(): ToolCallLog[] {
  return [...toolCallLog]; // Return a copy — log is append-only
  }
