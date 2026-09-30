import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useState } from "react";
import { Link } from "react-router";

import { HumanTaskPanel } from "@/components/task/HumanTaskPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function meta() {
  return [{ title: "Taken - Agent Office" }];
}

export default function TasksRoute() {
  const { data: tasks, isLoading } = useActionQuery("list-tasks", {});
  const { mutate: createTask, isPending } = useActionMutation("create-task");
  const [projectName, setProjectName] = useState("");
  const [taskTitle, setTaskTitle] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim() || !taskTitle.trim()) return;
    createTask(
      { projectName, taskTitle },
      {
        onSuccess: () => {
          setProjectName("");
          setTaskTitle("");
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Taken</h1>

      <p className="mb-6 text-sm text-muted-foreground">
        <a href="/agents" className="underline" data-testid="agents-beheren-link">
          Agents beheren
        </a>{" "}
        — maak agents vanuit een sjabloon of leeg, en test ze.
      </p>

      {/* "Wacht op jou" staat hier zodat iemand die elders gevraagd is de vraag
          ziet zonder eerst de taakpagina te openen. */}
      <div className="mb-6">
        <HumanTaskPanel />
      </div>

      <form onSubmit={handleSubmit} className="mb-8 space-y-4 rounded-lg border p-4">
        <div>
          <Label htmlFor="projectName">Projectnaam</Label>
          <Input
            id="projectName"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Bijv. Website redesign"
            required
          />
        </div>
        <div>
          <Label htmlFor="taskTitle">Taak</Label>
          <Input
            id="taskTitle"
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Bijv. Schrijf eerste concept"
            required
          />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Bezig..." : "Taak maken"}
        </Button>
      </form>

      {isLoading ? (
        <p>Taken laden...</p>
      ) : !tasks || tasks.length === 0 ? (
        <p className="text-muted-foreground">Nog geen taken. Maak er een hierboven.</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task: any) => (
            <li key={task.id}>
              <Link
                to={`/tasks/${encodeURIComponent(task.id)}`}
                className="block rounded-md border p-4 hover:bg-accent"
              >
                <div className="font-medium">{task.title}</div>
                <div className="text-sm text-muted-foreground">
                  {task.projectName} · {task.status}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
