import { defineNitroPlugin } from "@agent-native/core/server";

import { holdUntilPoolIdle, requestWaitUntil } from "../db/idle-release.js";

export default defineNitroPlugin((nitroApp) => {
  // Alleen in een Vercel-functie; lokaal zou de wachttijd het afsluiten van de server ophouden.
  if (!process.env.VERCEL_REGION) {
    return;
  }
  nitroApp.hooks.hook(
    "response",
    (_response: Response, event: { req?: unknown }) => {
      holdUntilPoolIdle(requestWaitUntil(event));
    },
  );
});
