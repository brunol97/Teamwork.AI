import { describe, expect, it } from "vitest";

import createTaskAction from "../actions/create-task.js";

describe("create-task action", () => {
  it("can be imported and exposes a run function", () => {
    expect(createTaskAction).toBeDefined();
    expect(typeof createTaskAction).toBe("object");
    expect(typeof createTaskAction.run).toBe("function");
  });

  it("creates a task with the caller as lead and status bezig", async () => {
    const result = await createTaskAction.run(
      { projectName: "Testproject", taskTitle: "Testtaak" },
      {
        caller: "frontend",
        userEmail: "tester@example.com",
        orgId: "org-test",
      } as any,
    );

    expect(result.title).toBe("Testtaak");
    expect(result.status).toBe("bezig");
    expect(result.leadId).toBe("tester@example.com");
    expect(result.organizationId).toBe("org-test");
    expect(result.projectName).toBe("Testproject");
  });
});
