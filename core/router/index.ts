/**
 * core/router/index.ts
  * Sigma Core OS — Task Router
   *
    * Receives incoming tasks, classifies intent, and dispatches
     * to the appropriate agent. All agent communication flows through here.
      */

      export type AgentName = 'sigma-bot' | 'sigma-dev' | 'sigma-research';

      export interface Task {
        id: string;
          type: string;
            payload: Record<string, unknown>;
              requestedBy: string;
                createdAt: Date;
                }

                export interface RoutedTask extends Task {
                  assignedAgent: AgentName;
                    routedAt: Date;
                    }

                    // Agent capability registry — agents register themselves here at startup
                    const agentRegistry: Map<AgentName, string[]> = new Map();

                    export function registerAgent(name: AgentName, capabilities: string[]): void {
                      agentRegistry.set(name, capabilities);
                        console.log(`[router] Agent registered: ${name} with capabilities: ${capabilities.join(', ')}`);
                        }

                        export function routeTask(task: Task): RoutedTask | null {
                          // TODO: Implement intent classification logic
                            // For now, use simple keyword-based routing
                              const type = task.type.toLowerCase();

                                let assignedAgent: AgentName | null = null;

                                  if (type.includes('trade') || type.includes('market') || type.includes('futures')) {
                                      assignedAgent = 'sigma-bot';
                                        } else if (type.includes('code') || type.includes('build') || type.includes('dev')) {
                                            assignedAgent = 'sigma-dev';
                                              } else if (type.includes('research') || type.includes('search') || type.includes('analysis')) {
                                                  assignedAgent = 'sigma-research';
                                                    }

                                                      if (!assignedAgent) {
                                                          console.warn(`[router] No agent found for task type: ${task.type}`);
                                                              return null;
                                                                }

                                                                  const routed: RoutedTask = {
                                                                      ...task,
                                                                          assignedAgent,
                                                                              routedAt: new Date(),
                                                                                };

                                                                                  console.log(`[router] Task ${task.id} routed to ${assignedAgent}`);
                                                                                    return routed;
                                                                                    }
                                                                                    
