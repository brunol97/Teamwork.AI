import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useState } from "react";
import { useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function meta() {
  return [{ title: "Taak - Agent Office" }];
}

export default function TaskDetailRoute() {
  const { taskId } = useParams<{ taskId: string }>();
  const { data, isLoading } = useActionQuery("get-task", { id: taskId ?? "" });
  const { mutate: sendMessage, isPending } = useActionMutation("send-task-message");
  const [message, setMessage] = useState("");

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

  if (isLoading) {
    return <div className="p-6">Taak laden...</div>;
  }

  if (!data?.task) {
    return <div className="p-6">Taak niet gevonden.</div>;
  }

  const { task, events } = data;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">{task.title}</h1>
        <p className="text-sm text-muted-foreground">
          {task.projectName} · {task.status} · lead: {task.leadId}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border p-4">
        {events.length === 0 ? (
          <p className="text-muted-foreground">
            Stuur een bericht om de agent te starten.
          </p>
        ) : (
          events.map((event: any) => (
            <div
              key={event.id}
              className={`rounded-lg p-3 ${
                event.actorType === "agent"
                  ? "bg-secondary text-secondary-foreground"
                  : "bg-muted"
              }`}
            >
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                {event.actorType === "agent" ? "Agent" : "Jij"}
              </div>
              <div className="whitespace-pre-wrap">{event.data}</div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <div className="flex-1">
          <Label htmlFor="message" className="sr-only">
            Bericht
          </Label>
          <Input
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Schrijf een bericht aan de agent..."
            disabled={isPending}
            required
          />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Bezig..." : "Verstuur"}
        </Button>
      </form>
    </div>
  );
}
