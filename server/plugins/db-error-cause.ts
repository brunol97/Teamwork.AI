import { defineNitroPlugin } from "@agent-native/core/server";

import { registerDriverCauseCapture } from "../db/error-cause.js";

// Bij het laden van de module, niet in de plugin-body: zie registerDriverCauseCapture.
registerDriverCauseCapture();

export default defineNitroPlugin(() => {});
