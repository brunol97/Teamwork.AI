import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  holdUntilPoolIdle,
  IDLE_RELEASE_MS,
  requestWaitUntil,
} from "../../server/db/idle-release.js";

function settled(promise: Promise<unknown>) {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  return () => done;
}

describe("instantie wakker houden tot de pool leeg is", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("wacht langer dan de idle_timeout van 20s van postgres-js", async () => {
    const promises: Promise<unknown>[] = [];
    expect(holdUntilPoolIdle((p) => promises.push(p))).toBe(true);
    expect(IDLE_RELEASE_MS).toBeGreaterThan(20_000);

    const isDone = settled(promises[0]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(isDone()).toBe(false);
    await vi.advanceTimersByTimeAsync(IDLE_RELEASE_MS - 20_000);
    expect(isDone()).toBe(true);
  });

  it("laat een nieuw antwoord de vorige wachttijd vervangen", async () => {
    const promises: Promise<unknown>[] = [];
    holdUntilPoolIdle((p) => promises.push(p));
    const firstDone = settled(promises[0]);
    await vi.advanceTimersByTimeAsync(10_000);

    holdUntilPoolIdle((p) => promises.push(p));
    const secondDone = settled(promises[1]);
    await vi.advanceTimersByTimeAsync(0);
    expect(firstDone()).toBe(true);
    expect(secondDone()).toBe(false);

    await vi.advanceTimersByTimeAsync(IDLE_RELEASE_MS);
    expect(secondDone()).toBe(true);
  });

  it("doet niets zonder waitUntil", () => {
    expect(holdUntilPoolIdle(undefined)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("waitUntil van het verzoek", () => {
  const key = Symbol.for("@vercel/request-context");
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[key];
  });

  it("neemt waitUntil van event.req", () => {
    const calls: unknown[] = [];
    const req = {
      waitUntil(this: unknown, p: Promise<unknown>) {
        calls.push([this, p]);
      },
    };
    const waitUntil = requestWaitUntil({ req });
    const promise = Promise.resolve();
    waitUntil?.(promise);
    expect(calls).toEqual([[req, promise]]);
  });

  it("valt terug op de request-context van Vercel", () => {
    const fromContext = vi.fn();
    (globalThis as Record<symbol, unknown>)[key] = {
      get: () => ({ waitUntil: fromContext }),
    };
    expect(requestWaitUntil({ req: {} })).toBe(fromContext);
  });

  it("geeft undefined buiten Vercel", () => {
    expect(requestWaitUntil({ req: {} })).toBeUndefined();
  });
});
