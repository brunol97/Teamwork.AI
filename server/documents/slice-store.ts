import { applyWorkDocumentChange, getWorkDocument, type ActorType, type WorkDocument } from "./store.js";
import {
  extractRequirements,
  parseSlices,
  upsertSlicesSection,
  type TracerSlice,
  type WorkRequirement,
} from "./slices.js";

/**
 * De serverkant van de tracer-slices. Slices zijn een sectie in het
 * werkdocument, dus lezen is het werkdocument parsen en schrijven is de
 * sectie vervangen — via de bestaande werkdocumentopslag, met de
 * versiecontrole en de activiteitenlog die daar horen.
 */

export interface TracerSliceRead {
  slices: TracerSlice[];
  requirements: WorkRequirement[];
  markdown: string;
}

/**
 * Leest de tracer-slices en de requirements van een taak. Geeft undefined
 * terug wanneer de taak niet in de organisatie van de aanroeper zit.
 */
export async function readTracerSlices(
  taskId: string,
  orgId: string,
): Promise<TracerSliceRead | undefined> {
  const document = await getWorkDocument(taskId, orgId);
  if (!document) {
    return undefined;
  }
  return {
    slices: parseSlices(document.markdown),
    requirements: extractRequirements(document.markdown),
    markdown: document.markdown,
  };
}

/**
 * Schrijft de Tracer-slices-sectie weg en logt de wijziging. De schrijfactie
 * gaat door de werkdocumentopslag, dus de versie loopt mee en de log-regel
 * ontstaat in dezelfde transactie.
 */
export async function writeTracerSlices({
  taskId,
  orgId,
  slices,
  actorType,
  actorId,
  eventType,
  eventData,
}: {
  taskId: string;
  orgId: string;
  slices: TracerSlice[];
  actorType: ActorType;
  actorId: string;
  eventType: string;
  eventData: string | null;
}): Promise<WorkDocument | undefined> {
  return applyWorkDocumentChange({
    taskId,
    orgId,
    actorType,
    actorId,
    eventType,
    eventData,
    change: (current) => upsertSlicesSection(current, slices),
  });
}
