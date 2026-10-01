import { afterEach, describe, expect, it } from "vitest";

import {
  getAllowedEmails,
  isAuthDisabled,
  isEmailAllowed,
} from "../../server/auth/allowlist";
import {
  emailAllowlistPlugin,
  emailFromSignInSection,
  matchesSignInSection,
} from "../../server/auth/email-allowlist-plugin";
import { withEnv } from "../helpers/env";

afterEach(() => {
  delete process.env.AUTH_ALLOWED_EMAILS;
  delete process.env.AUTH_DISABLED;
});

describe("getAllowedEmails", () => {
  it("gebruikt de standaardlijst zonder omgevingsvariabele", async () => {
    await withEnv({}, () => {
      expect(getAllowedEmails()).toEqual(["bruno.lenderink@gmail.com"]);
    });
  });

  it("leest een kommalijst en negeert lege entries en witruimte", async () => {
    await withEnv({ AUTH_ALLOWED_EMAILS: " A@Example.com , b@x.nl,, " }, () => {
      expect(getAllowedEmails()).toEqual(["a@example.com", "b@x.nl"]);
    });
  });

  it("valt terug op de standaardlijst bij een lege waarde", async () => {
    await withEnv({ AUTH_ALLOWED_EMAILS: "  " }, () => {
      expect(getAllowedEmails()).toEqual(["bruno.lenderink@gmail.com"]);
    });
  });
});

describe("isAuthDisabled", () => {
  it("is waar bij true of 1", async () => {
    await withEnv({ AUTH_DISABLED: "TRUE" }, () => {
      expect(isAuthDisabled()).toBe(true);
    });
    await withEnv({ AUTH_DISABLED: "1" }, () => {
      expect(isAuthDisabled()).toBe(true);
    });
  });

  it("is onwaar zonder of met een andere waarde", async () => {
    await withEnv({}, () => {
      expect(isAuthDisabled()).toBe(false);
    });
    await withEnv({ AUTH_DISABLED: "false" }, () => {
      expect(isAuthDisabled()).toBe(false);
    });
  });
});

describe("isEmailAllowed", () => {
  it("staat het standaardadres toe, hoofdletterongevoelig", async () => {
    await withEnv({}, () => {
      expect(isEmailAllowed("Bruno.Lenderink@Gmail.com")).toBe(true);
      expect(isEmailAllowed(" bruno.lenderink@gmail.com ")).toBe(true);
    });
  });

  it("weigert andere adressen", async () => {
    await withEnv({}, () => {
      expect(isEmailAllowed("ander@example.com")).toBe(false);
      expect(isEmailAllowed(undefined)).toBe(false);
      expect(isEmailAllowed("")).toBe(false);
    });
  });

  it("staat de dev-accountjes van het framework altijd toe", async () => {
    await withEnv({}, () => {
      expect(isEmailAllowed("dev@local.test")).toBe(true);
      expect(isEmailAllowed("dev@local")).toBe(true);
    });
  });

  it("staat een adres uit AUTH_ALLOWED_EMAILS toe", async () => {
    await withEnv(
      { AUTH_ALLOWED_EMAILS: "bruno.lenderink@gmail.com,team@example.com" },
      () => {
        expect(isEmailAllowed("TEAM@example.com")).toBe(true);
        expect(isEmailAllowed("ander@example.com")).toBe(false);
      },
    );
  });

  it("staat bij AUTH_DISABLED alles toe", async () => {
    await withEnv({ AUTH_DISABLED: "true" }, () => {
      expect(isEmailAllowed("ander@example.com")).toBe(true);
    });
  });
});

describe("emailAllowlistPlugin hook", () => {
  const hook = emailAllowlistPlugin.hooks.before[0];

  it("werpt voor een niet-toegestaan adres", async () => {
    await withEnv({}, async () => {
      await expect(
        hook.handler({ body: { email: "ander@example.com" } }),
      ).rejects.toThrow(/beperkt/);
      await hook.handler({ body: { email: "bruno.lenderink@gmail.com" } });
    });
  });

  it("grijpt niet in zonder e-mailadres in de body", async () => {
    await withEnv({}, async () => {
      await hook.handler({ body: {} });
      await hook.handler({});
    });
  });
});

describe("sign-in sectie matching", () => {
  it("matcht sign-in en sign-up paden", () => {
    expect(matchesSignInSection("/sign-in/magic-link")).toBe(true);
    expect(matchesSignInSection("/sign-in/email")).toBe(true);
    expect(matchesSignInSection("/sign-up/email")).toBe(true);
    expect(matchesSignInSection("/sign-in")).toBe(true);
    expect(matchesSignInSection(undefined)).toBe(false);
    expect(matchesSignInSection("/magic-link/verify")).toBe(false);
    expect(matchesSignInSection("/get-session")).toBe(false);
    expect(matchesSignInSection("/change-password")).toBe(false);
  });

  it("leest het e-mailadres uit de body", () => {
    expect(emailFromSignInSection({ email: "a@b.c" })).toBe("a@b.c");
    expect(emailFromSignInSection({})).toBeUndefined();
    expect(emailFromSignInSection({ email: 42 })).toBeUndefined();
    expect(emailFromSignInSection(undefined)).toBeUndefined();
    expect(emailFromSignInSection({ email: "" })).toBeUndefined();
  });
});
