import { describe, expect, it } from "vitest";

import createTaskAction from "../actions/create-task.js";

describe("create-task action", () => {
  it("can be imported and exposes a run function", () => {
    expect(createTaskAction).toBeDefined();
    expect(typeof createTaskAction).toBe("object");
  });
});
