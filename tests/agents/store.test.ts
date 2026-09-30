import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createAgent,
  deleteAgent,
  getAgent,
  getAgentByName,
  listAgents,
  updateAgent,
} from "../../server/agents/store.js";

/**
 * Elke testwerker hergebruikt zijn eigen PGlite-directory, dus agentnamen uit
 * een eerdere run staan er nog in. Elke run krijgt daarom zijn eigen unieke
 * namen, zoals de E2E-tests dat ook doen met hun taken.
 */
const perRun = `${Date.now()}-${randomUUID().slice(0, 8)}-`;
const uniek = (naam: string) => `${perRun}${naam}`;

describe("agents store", () => {
  it("maakt een agent aan en maakt hem direct in de hele organisatie beschikbaar", async () => {
    const agent = await createAgent({
      orgId: "org-agents",
      name: uniek("Onderzoeker"),
      description: "Verzamelt informatie.",
      tools: ["web-zoeken"],
      skills: ["rechercheren"],
      createdBy: "lead@example.com",
    });

    expect(agent.name.endsWith("Onderzoeker")).toBe(true);
    expect(agent.enabled).toBe(true);
    expect(agent.organizationId).toBe("org-agents");
    expect(agent.tools).toEqual(["web-zoeken"]);

    // Een agent is een bron van de organisatie: hij hangt aan geen taak en is
    // daarmee meteen in alle taken beschikbaar.
    const lijst = await listAgents("org-agents");
    expect(lijst.some((a) => a.id === agent.id)).toBe(true);
  });

  it("staat dezelfde naam in een andere organisatie toe, maar niet twee keer in dezelfde", async () => {
    const naam = uniek("Schrijver");
    await createAgent({
      orgId: "org-dup",
      name: naam,
      createdBy: "lead@example.com",
    });

    await expect(
      createAgent({
        orgId: "org-dup",
        name: naam,
        createdBy: "lead@example.com",
      }),
    ).rejects.toThrow();

    await createAgent({
      orgId: `org-anders-${naam}`,
      name: naam,
      createdBy: "lead@example.com",
    });
    expect((await getAgentByName(naam, `org-anders-${naam}`))?.name).toBe(naam);
  });

  it("zoekt op naam zonder hoofdlettergevoeligheid, binnen de organisatie", async () => {
    const naam = uniek("Reviewer");
    await createAgent({
      orgId: "org-naam",
      name: naam,
      createdBy: "lead@example.com",
    });

    expect((await getAgentByName(naam.toUpperCase(), "org-naam"))?.name).toBe(
      naam,
    );
    expect(await getAgentByName(naam, "org-anders")).toBeUndefined();
  });

  it("werkt velden bij en houdt de organisatiegrens aan", async () => {
    const agent = await createAgent({
      orgId: "org-update",
      name: uniek("Schrijver"),
      createdBy: "lead@example.com",
    });

    const bijgewerkt = await updateAgent(agent.id, "org-update", {
      description: "Schrijft teksten.",
      tools: ["werkdocument-schrijven"],
      enabled: false,
    });
    expect(bijgewerkt?.description).toBe("Schrijft teksten.");
    expect(bijgewerkt?.tools).toEqual(["werkdocument-schrijven"]);
    expect(bijgewerkt?.enabled).toBe(false);

    // Een andere organisatie kan de agent niet zien of bijwerken.
    expect(await getAgent(agent.id, "org-anders")).toBeUndefined();
    expect(
      await updateAgent(agent.id, "org-anders", { description: "hacks" }),
    ).toBeUndefined();
  });

  it("verwijdert alleen binnen de eigen organisatie", async () => {
    const agent = await createAgent({
      orgId: "org-delete",
      name: uniek("Reviewer"),
      createdBy: "lead@example.com",
    });

    expect(await deleteAgent(agent.id, "org-anders")).toBe(false);
    expect(await getAgent(agent.id, "org-delete")).toBeDefined();

    expect(await deleteAgent(agent.id, "org-delete")).toBe(true);
    expect(await getAgent(agent.id, "org-delete")).toBeUndefined();
  });
});
