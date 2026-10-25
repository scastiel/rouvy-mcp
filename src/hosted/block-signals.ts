import type { Clock } from "../rouvy/clock.js";
import type { BlockSignal } from "./log.js";

/** What the Durable Object's own storage offers, which survives its evictions. */
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

const KEY = "block-signals";
const DAY_MS = 24 * 60 * 60_000;

interface Signal {
  kind: BlockSignal;
  at: number;
}

/**
 * The hard block signals of the last 24 h (spec-m2 §9): when each was seen, nothing else. Kept in
 * the Durable Object's storage, so an eviction doesn't hide a block.
 */
export function createBlockSignals(store: Store, clock: Clock) {
  async function lastDay(): Promise<Signal[]> {
    const since = clock.now() - DAY_MS;
    return ((await store.get<Signal[]>(KEY)) ?? []).filter((signal) => signal.at > since);
  }

  return {
    async record(kind: BlockSignal): Promise<void> {
      const signals = await lastDay();
      await store.put(KEY, [...signals, { kind, at: clock.now() }]);
    },
    lastDay,
  };
}
