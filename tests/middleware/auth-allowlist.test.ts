import { beforeEach, describe, expect, it, vi } from "vitest";

const runAuthGuard = vi.fn();
const getSession = vi.fn();
const logout = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  runAuthGuard,
  getSession,
  logout,
}));

const setResponseStatus = vi.fn();
const sendRedirect = vi.fn();

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (event: { headers?: Headers }, name: string) =>
    event.headers?.get(name) ?? undefined,
  sendRedirect,
  setResponseStatus,
}));

import handler from "../../server/middleware/auth";
import { withEnv } from "../helpers/env";

function event(path: string, cookie?: string, accept?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (accept) headers.set("accept", accept);
  return { path, headers };
}

beforeEach(() => {
  runAuthGuard.mockReset();
  runAuthGuard.mockResolvedValue(undefined);
  getSession.mockReset();
  logout.mockReset();
  logout.mockResolvedValue({ ok: true });
  sendRedirect.mockReset();
  setResponseStatus.mockReset();
});

describe("auth-middleware allowlist-backstop", () => {
  it("geeft de guard-respons direct door", async () => {
    const guard = new Response("blocked");
    runAuthGuard.mockResolvedValue(guard);
    await expect(handler(event("/api/x"))).resolves.toBe(guard);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("slaat de sessiecheck over zonder sessiecookie", async () => {
    await handler(event("/", "koekje=1"));
    expect(getSession).not.toHaveBeenCalled();
  });

  it("doet niets zonder sessie of met een toegestaan adres", async () => {
    const sessionCookie = "an.session_token=abc";
    getSession.mockResolvedValue(null);
    await handler(event("/", sessionCookie));
    expect(logout).not.toHaveBeenCalled();

    getSession.mockResolvedValue({ email: "bruno.lenderink@gmail.com" });
    await handler(event("/", sessionCookie));
    expect(logout).not.toHaveBeenCalled();
  });

  it("trekt een sessie van een niet-toegestaan adres in en weigert api-routes", async () => {
    await withEnv({ AUTH_ALLOWED_EMAILS: "bruno.lenderink@gmail.com" }, () =>
      (async () => {
        getSession.mockResolvedValue({ email: "ander@example.com" });
        await handler(
          event("/_agent-native/actions/get-overzicht", "an.session_token=abc"),
        );
        expect(logout).toHaveBeenCalledTimes(1);
        expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 401);
      })(),
    );
  });

  it("stuurt een pagina-verzoek van een niet-toegestaan adres naar /", async () => {
    await withEnv({ AUTH_ALLOWED_EMAILS: "bruno.lenderink@gmail.com" }, () =>
      (async () => {
        getSession.mockResolvedValue({ email: "ander@example.com" });
        await handler(event("/taken/1", "an.session_token=abc", "text/html"));
        expect(logout).toHaveBeenCalledTimes(1);
        expect(sendRedirect).toHaveBeenCalledWith(expect.anything(), "/", 302);
      })(),
    );
  });

  it("controleert niets bij AUTH_DISABLED", async () => {
    await withEnv({ AUTH_DISABLED: "true" }, () =>
      (async () => {
        await handler(event("/", "an.session_token=abc"));
        expect(getSession).not.toHaveBeenCalled();
      })(),
    );
  });
});
