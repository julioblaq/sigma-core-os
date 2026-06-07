// Minimal Redis client for the agent task queue.
// Supports the small command set needed by Railway workers without extra deps.

import net from 'net';
import tls from 'tls';

type RedisScalar = string | number;
type RedisValue = string | number | null | RedisValue[];

interface RedisConnectionOptions {
  url: string;
}

function encodeCommand(parts: RedisScalar[]): string {
  return `*${parts.length}\r\n${parts.map((part) => {
    const value = String(part);
    return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
  }).join('')}`;
}

function parseInteger(buffer: Buffer, start: number): { value: number; next: number } | null {
  const end = buffer.indexOf('\r\n', start);
  if (end === -1) return null;
  return { value: Number(buffer.toString('utf8', start, end)), next: end + 2 };
}

function parseValue(buffer: Buffer, start = 0): { value: RedisValue; next: number } | null {
  if (start >= buffer.length) return null;
  const prefix = String.fromCharCode(buffer[start]);
  if (prefix === '+' || prefix === ':' || prefix === '-') {
    const end = buffer.indexOf('\r\n', start + 1);
    if (end === -1) return null;
    const raw = buffer.toString('utf8', start + 1, end);
    if (prefix === '-') throw new Error(`[redis] ${raw}`);
    return { value: prefix === ':' ? Number(raw) : raw, next: end + 2 };
  }

  if (prefix === '$') {
    const len = parseInteger(buffer, start + 1);
    if (!len) return null;
    if (len.value === -1) return { value: null, next: len.next };
    const end = len.next + len.value;
    if (buffer.length < end + 2) return null;
    return { value: buffer.toString('utf8', len.next, end), next: end + 2 };
  }

  if (prefix === '*') {
    const count = parseInteger(buffer, start + 1);
    if (!count) return null;
    if (count.value === -1) return { value: null, next: count.next };
    const values: RedisValue[] = [];
    let next = count.next;
    for (let i = 0; i < count.value; i++) {
      const parsed = parseValue(buffer, next);
      if (!parsed) return null;
      values.push(parsed.value);
      next = parsed.next;
    }
    return { value: values, next };
  }

  throw new Error(`[redis] unsupported response prefix '${prefix}'`);
}

export class RedisConnection {
  private readonly url: URL;
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = Buffer.alloc(0);
  private connected = false;

  constructor(options: RedisConnectionOptions) {
    this.url = new URL(options.url);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const port = Number(this.url.port || 6379);
    const host = this.url.hostname;
    const socket = this.url.protocol === 'rediss:'
      ? tls.connect({ host, port })
      : net.connect({ host, port });
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    this.connected = true;

    const password = decodeURIComponent(this.url.password);
    const username = decodeURIComponent(this.url.username);
    if (password) {
      if (username) await this.command('AUTH', username, password);
      else await this.command('AUTH', password);
    }

    const db = this.url.pathname.replace('/', '');
    if (db) await this.command('SELECT', db);
  }

  async command(...parts: RedisScalar[]): Promise<RedisValue> {
    if (!this.socket || !this.connected) await this.connect();
    const socket = this.socket;
    if (!socket) throw new Error('[redis] socket unavailable');

    socket.write(encodeCommand(parts));
    return new Promise<RedisValue>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        try {
          this.buffer = Buffer.concat([this.buffer, chunk]);
          const parsed = parseValue(this.buffer);
          if (!parsed) return;
          this.buffer = this.buffer.subarray(parsed.next);
          cleanup();
          resolve(parsed.value);
        } catch (err) {
          cleanup();
          reject(err);
        }
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        socket.off('data', onData);
        socket.off('error', onError);
      };
      socket.on('data', onData);
      socket.once('error', onError);
    });
  }

  close(): void {
    this.connected = false;
    this.socket?.destroy();
    this.socket = null;
    this.buffer = Buffer.alloc(0);
  }
}

export function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is required when TASK_QUEUE_MODE=redis');
  return url;
}
