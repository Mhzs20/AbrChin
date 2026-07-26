import { hostname } from "node:os";

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getWorkerConfig() {
  return {
    workerId: process.env.WORKER_ID?.trim() || `worker-${hostname()}-${process.pid}`,
    pollMs: readInt("WORKER_POLL_MS", 3000),
    maxIdleRounds: readInt("WORKER_MAX_IDLE_ROUNDS", 20),
    leaseMs: readInt("WORKER_LEASE_MS", 120_000),
    staleAfterMs: readInt("WORKER_STALE_AFTER_MS", 90_000),
  };
}
