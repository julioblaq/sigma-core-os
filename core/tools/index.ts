/**
 * core/tools/index.ts
 * Minimal tool registry — placeholder for slice 2.
 * Agents register tools here; all calls are logged.
 */

export interface Tool {
    name: string;
    description: string;
    allowedAgents: string[];
    run: (input: Record<string, unknown>) => Promise<unknown>;
}

const registry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
    registry.set(tool.name, tool);
    console.log(`[tools] registered: ${tool.name}`);
}

export function getTool(name: string): Tool | undefined {
    return registry.get(name);
}

export function listTools(): Tool[] {
    return [...registry.values()];
}
