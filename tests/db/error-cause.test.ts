import { sql } from "@agent-native/core/db/schema";
import {
  captureError,
  registerErrorCaptureProvider,
  type CaptureErrorContext,
} from "@agent-native/core/server";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "../../server/db/client.js";
import { driverCause, registerDriverCauseCapture } from "../../server/db/error-cause.js";

function connectTimeout() {
  return Object.assign(new Error("write CONNECT_TIMEOUT pooler.example.com:6543"), {
    code: "CONNECT_TIMEOUT",
  });
}

describe("driverfout in gevangen excepties", () => {
  const unregister: Array<() => void> = [];
  afterEach(() => {
    while (unregister.length) unregister.pop()?.();
  });

  it("geeft de framework-provider de code en melding van de driver mee", () => {
    unregister.push(registerDriverCauseCapture());
    const seen: CaptureErrorContext[] = [];
    unregister.push(
      registerErrorCaptureProvider("test-tracking", (_error, context) => {
        seen.push(structuredClone(context));
      }),
    );

    const error = new Error('Failed query: select "organization_id" from "organization_settings"', {
      cause: connectTimeout(),
    });
    captureError(error, { extra: { request_id: "req-1" } });

    expect(seen).toHaveLength(1);
    expect(seen[0].extra).toEqual({
      request_id: "req-1",
      cause_name: "Error",
      cause_code: "CONNECT_TIMEOUT",
      cause_message: "write CONNECT_TIMEOUT pooler.example.com:6543",
    });
  });

  it("laat een fout zonder cause ongemoeid", () => {
    unregister.push(registerDriverCauseCapture());
    const seen: CaptureErrorContext[] = [];
    unregister.push(
      registerErrorCaptureProvider("test-tracking", (_error, context) => {
        seen.push(structuredClone(context));
      }),
    );

    captureError(new Error("boom"), { tags: { action: "list-human-tasks" } });

    expect(seen[0]).toEqual({ tags: { action: "list-human-tasks" } });
  });

  it("volgt de keten tot de diepste cause", () => {
    const error = new Error("Failed query", {
      cause: new Error("wrapper", { cause: connectTimeout() }),
    });

    expect(driverCause(error)).toEqual({
      name: "Error",
      code: "CONNECT_TIMEOUT",
      message: "write CONNECT_TIMEOUT pooler.example.com:6543",
    });
  });

  it("vindt de driverfout achter een echte mislukte Drizzle-query", async () => {
    const error = await getDb()
      .execute(sql`select * from tabel_die_niet_bestaat`)
      .then(
        () => undefined,
        (err: unknown) => err,
      );

    expect((error as Error).message).toContain("Failed query");
    const cause = driverCause(error);
    expect(cause?.code).toBe("42P01");
    expect(cause?.message).toContain("tabel_die_niet_bestaat");
  });
});
