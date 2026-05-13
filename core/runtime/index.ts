/**
 * core/runtime/index.ts
  * Sigma Core OS — Agent Runtime / Lifecycle Manager
   *
    * Manages agent startup, monitoring, and graceful shutdown.
     */

     export type AgentStatus = 'stopped' | 'starting' | 'running' | 'error';

     export interface AgentProcess {
       name: string;
         status: AgentStatus;
           startedAt?: Date;
             stoppedAt?: Date;
               errorMessage?: string;
                 pid?: number;
                 }

                 // Runtime registry of all managed agents
                 const runtime: Map<string, AgentProcess> = new Map();

                 export function registerAgentProcess(name: string): void {
                   runtime.set(name, { name, status: 'stopped' });
                     console.log(`[runtime] Agent registered: ${name}`);
                     }

                     export function startAgent(name: string): void {
                       const agent = runtime.get(name);
                         if (!agent) throw new Error(`[runtime] Unknown agent: ${name}`);
                           if (agent.status === 'running') {
                               console.warn(`[runtime] Agent ${name} is already running`);
                                   return;
                                     }

                                       agent.status = 'starting';
                                         agent.startedAt = new Date();
                                           console.log(`[runtime] Starting agent: ${name}`);

                                             // TODO: Spawn actual agent process here
                                               // For now, just mark as running
                                                 agent.status = 'running';
                                                   console.log(`[runtime] Agent running: ${name}`);
                                                   }

                                                   export function stopAgent(name: string): void {
                                                     const agent = runtime.get(name);
                                                       if (!agent) throw new Error(`[runtime] Unknown agent: ${name}`);

                                                         agent.status = 'stopped';
                                                           agent.stoppedAt = new Date();
                                                             console.log(`[runtime] Agent stopped: ${name}`);
                                                             }

                                                             export function getAgentStatus(name: string): AgentProcess | undefined {
                                                               return runtime.get(name);
                                                               }

                                                               export function listAgents(): AgentProcess[] {
                                                                 return Array.from(runtime.values());
                                                                 }

                                                                 export function markAgentError(name: string, error: string): void {
                                                                   const agent = runtime.get(name);
                                                                     if (!agent) return;

                                                                       agent.status = 'error';
                                                                         agent.errorMessage = error;
                                                                           console.error(`[runtime] Agent error: ${name} — ${error}`);
                                                                           }

                                                                           // Graceful shutdown of all agents
                                                                           export async function shutdownAll(): Promise<void> {
                                                                             console.log('[runtime] Initiating graceful shutdown of all agents...');
                                                                               for (const [name, agent] of runtime.entries()) {
                                                                                   if (agent.status === 'running') {
                                                                                         stopAgent(name);
                                                                                             }
                                                                                               }
                                                                                                 console.log('[runtime] All agents stopped.');
                                                                                                 }
                                                                                                 
