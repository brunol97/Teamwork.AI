import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";

import { ActiveAgentPanel } from "@/components/task/ActiveAgentPanel";
import { DocumentSectiesPanel } from "@/components/task/DocumentSectiesPanel";
import { EvaluatiesPanel } from "@/components/task/EvaluatiesPanel";
import { FollowTaskButton, MeldingenPanel } from "@/components/task/MeldingenPanel";
import { HumanTaskPanel } from "@/components/task/HumanTaskPanel";
import { InviteLinkPanel } from "@/components/task/InviteLinkPanel";
import { OverdrachtPanel } from "@/components/task/OverdrachtPanel";
import { PresenceBar } from "@/components/task/PresenceBar";
import { TracerSlicesPanel } from "@/components/task/TracerSlicesPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeEvent, type ActivityEvent } from "@/lib/activity-log";
import { userFacingActionError } from "@/lib/action-error";
import {
  insertDocumentBlock,
  type DocumentBlockKind,
} from "@/lib/document-editor";

export function meta() {
  return [{ title: "Taak - Agent Office" }];
}

const WORK_DOCUMENT_BLOCKS: { kind: DocumentBlockKind; label: string }[] = [
  { kind: "kop1", label: "Kop 1" },
  { kind: "kop2", label: "Kop 2" },
  { kind: "kop3", label: "Kop 3" },
  { kind: "opsomming", label: "Opsomming" },
  { kind: "genummerd", label: "Genummerd" },
  { kind: "tabel", label: "Tabel" },
];

export default function TaskDetailRoute() {
  const { taskId } = useParams<{ taskId: string }>();
  const { data, isLoading } = useActionQuery("get-task", { id: taskId ?? "" });
  const { data: workDocument, refetch: refetchWorkDocument } = useActionQuery(
    "get-work-document",
    { taskId: taskId ?? "" },
  );
  const { mutate: sendMessage, isPending } = useActionMutation("send-task-message");
  const { mutate: rondAf, isPending: rondtAf } =
    useActionMutation("complete-task");
  const { mutate: saveWorkDocument, isPending: isSaving } = useActionMutation(
    "update-work-document",
  );
  const [message, setMessage] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [version, setVersion] = useState(0);
  const [conflict, setConflict] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Volg het werkdocument van de server zolang de gebruiker niets heeft getypt.
  useEffect(() => {
    if (workDocument && !unsavedChanges) {
      setMarkdown(workDocument.markdown);
      setVersion(workDocument.version);
    }
  }, [workDocument, unsavedChanges]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskId || !message.trim()) return;
    sendMessage(
      { taskId, message },
      {
        onSuccess: () => {
          setMessage("");
        },
      },
    );
  };

  const insertBlock = (kind: DocumentBlockKind) => {
    const editor = editorRef.current;
    const start = editor?.selectionStart ?? markdown.length;
    const end = editor?.selectionEnd ?? start;
    const insertion = insertDocumentBlock(markdown, start, end, kind);
    setMarkdown(insertion.markdown);
    setUnsavedChanges(true);
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(insertion.caret, insertion.caret);
    });
  };

  const save = () => {
    if (!taskId) return;
    saveWorkDocument(
      { taskId, markdown, expectedVersion: version },
      {
        onSuccess: (document) => {
          setUnsavedChanges(false);
          setConflict(null);
          setVersion(document.version);
        },
        onError: (error) => {
          setConflict(
            userFacingActionError(error, "Opslaan mislukt. Probeer het opnieuw."),
          );
        },
      },
    );
  };

  if (isLoading) {
    return <div className="p-6">Taak laden...</div>;
  }

  if (!data?.task) {
    return <div className="p-6">Taak niet gevonden.</div>;
  }

  const { task, events } = data;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{task.title}</h1>
          <p className="text-sm text-muted-foreground">
            {task.projectName} · {task.status} · lead: {task.leadId}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <FollowTaskButton taskId={task.id} />
          <PresenceBar taskId={task.id} />
        </div>
      </div>

      {task.status !== "klaar" ? (
        <div className="mb-4">
          <Button
            type="button"
            data-testid="taak-afronden"
            disabled={rondtAf}
            onClick={() =>
              rondAf(
                { taskId: task.id },
                {
                  onError: (error) =>
                    setConflict(
                      userFacingActionError(
                        error,
                        "Afronden mislukt. Probeer het opnieuw.",
                      ),
                    ),
                },
              )
            }
          >
            {rondtAf ? "Bezig..." : "Taak afronden"}
          </Button>
        </div>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground" data-testid="taak-klaar">
          Deze taak is afgerond; de evaluatie staat hieronder.
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col rounded-lg border p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Werkdocument</h2>
            <span className="text-xs text-muted-foreground">
              {unsavedChanges ? "Niet opgeslagen" : "Opgeslagen"}
            </span>
          </div>

          <div className="mb-2 flex flex-wrap gap-1">
            {WORK_DOCUMENT_BLOCKS.map((block) => (
              <Button
                key={block.kind}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => insertBlock(block.kind)}
              >
                {block.label}
              </Button>
            ))}
          </div>

          <textarea
            ref={editorRef}
            aria-label="Werkdocument in markdown"
            value={markdown}
            onChange={(e) => {
              setMarkdown(e.target.value);
              setUnsavedChanges(true);
            }}
            placeholder="# Eisen&#10;&#10;- Snelheid&#10;- Kosten"
            className="min-h-0 flex-1 resize-none rounded-md border bg-transparent p-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />

          <div className="mt-2 flex items-center gap-2">
            <Button type="button" onClick={save} disabled={!unsavedChanges || isSaving}>
              {isSaving ? "Bezig..." : "Opslaan"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Vraag de agent om een sectie te schrijven, bijvoorbeeld &quot;Schrijf een
              sectie over datamigratie&quot;.
            </p>
          </div>

          {conflict ? (
            <div
              role="alert"
              data-testid="conflict-melding"
              className="mt-2 rounded-md border p-2 text-xs"
            >
              {conflict} Jouw tekst staat nog in het veld; herlaad om de versie van de
              ander te zien.
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-2"
                onClick={() => {
                  setUnsavedChanges(false);
                  setConflict(null);
                  refetchWorkDocument();
                }}
              >
                Herladen
              </Button>
            </div>
          ) : null}

          <DocumentSectiesPanel taskId={task.id} deelnemers={data.deelnemers ?? []} />
        </section>

        <section className="flex min-h-0 flex-col gap-3">
          <HumanTaskPanel taskId={task.id} />
          <OverdrachtPanel
            taskId={task.id}
            taskStatus={task.status}
            leadId={task.leadId}
          />
          <ActiveAgentPanel
            taskId={task.id}
            activeAgentId={task.activeAgentId}
            taskStatus={task.status}
          />
          <TracerSlicesPanel taskId={task.id} />
          <EvaluatiesPanel taskId={task.id} />
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border p-4">
            {events.length === 0 ? (
              <p className="text-muted-foreground">
                Stuur een bericht om de agent te starten.
              </p>
            ) : (
              events.map((event: ActivityEvent) => {
                const { actor, text } = describeEvent(event);
                return (
                  <div
                    key={event.id}
                    className={`rounded-lg p-3 ${
                      event.actorType === "agent"
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      {actor}
                    </div>
                    <div className="whitespace-pre-wrap">{text}</div>
                  </div>
                );
              })
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="message" className="sr-only">
                Bericht
              </Label>
              <Input
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Schrijf een bericht aan de agent, bijvoorbeeld @naam..."
                disabled={isPending}
                required
              />
            </div>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Bezig..." : "Verstuur"}
            </Button>
          </form>

          <MeldingenPanel taskId={task.id} />
          <InviteLinkPanel taskId={task.id} />
        </section>
      </div>
    </div>
  );
}
