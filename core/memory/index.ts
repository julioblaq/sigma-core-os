/**
 * core/memory/index.ts
  * Sigma Core OS — Shared Memory Store
   *
    * Provides namespaced key-value storage for agents.
     * Short-term: in-memory Map (dev). Long-term: Redis + SQLite (production).
      */

      export interface MemoryEntry {
        namespace: string;
          key: string;
            value: unknown;
              writtenBy: string;
                writtenAt: Date;
                  ttl?: number; // seconds, optional
                  }

                  // In-memory store for development
                  const store: Map<string, MemoryEntry> = new Map();

                  function buildKey(namespace: string, key: string): string {
                    return `${namespace}:${key}`;
                    }

                    export function memoryWrite(
                      namespace: string,
                        key: string,
                          value: unknown,
                            writtenBy: string,
                              ttl?: number
                              ): void {
                                const entry: MemoryEntry = {
                                    namespace,
                                        key,
                                            value,
                                                writtenBy,
                                                    writtenAt: new Date(),
                                                        ttl,
                                                          };
                                                            store.set(buildKey(namespace, key), entry);
                                                              console.log(`[memory] Written: ${namespace}:${key} by ${writtenBy}`);
                                                              }

                                                              export function memoryRead(namespace: string, key: string): unknown | null {
                                                                const entry = store.get(buildKey(namespace, key));
                                                                  if (!entry) return null;

                                                                    // Check TTL expiry
                                                                      if (entry.ttl) {
                                                                          const ageSeconds = (Date.now() - entry.writtenAt.getTime()) / 1000;
                                                                              if (ageSeconds > entry.ttl) {
                                                                                    store.delete(buildKey(namespace, key));
                                                                                          return null;
                                                                                              }
                                                                                                }

                                                                                                  return entry.value;
                                                                                                  }

                                                                                                  export function memoryDelete(namespace: string, key: string, deletedBy: string): boolean {
                                                                                                    const exists = store.has(buildKey(namespace, key));
                                                                                                      if (exists) {
                                                                                                          store.delete(buildKey(namespace, key));
                                                                                                              console.log(`[memory] Deleted: ${namespace}:${key} by ${deletedBy}`);
                                                                                                                }
                                                                                                                  return exists;
                                                                                                                  }
                                                                                                                  
                                                                                                                  export function memoryListNamespace(namespace: string): MemoryEntry[] {
                                                                                                                    return Array.from(store.values()).filter((e) => e.namespace === namespace);
                                                                                                                    }
                                                                                                                    
