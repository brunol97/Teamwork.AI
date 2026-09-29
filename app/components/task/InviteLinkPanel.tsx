import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type InviteLink = {
  id: string;
  token: string;
  state: "geldig" | "verlopen" | "ingetrokken";
  expiresAt: number;
  createdBy: string;
};

const STATE_LABEL: Record<InviteLink["state"], string> = {
  geldig: "Geldig",
  verlopen: "Verlopen",
  ingetrokken: "Ingetrokken",
};

function linkVoor(token: string): string {
  if (typeof window === "undefined") return `/uitnodiging/${token}`;
  return `${window.location.origin}/uitnodiging/${token}`;
}

/**
 * Uitnodigingslinks van een taak. Alleen een beheerder ziet dit paneel; de
 * tweede persoon opent de link en komt zonder keuzescherm in de taak.
 */
export function InviteLinkPanel({ taskId }: { taskId: string }) {
  const { data, isError } = useActionQuery("list-invite-links", { taskId });
  const { mutate: createLink, isPending } = useActionMutation("create-invite-link");
  const { mutate: revoke } = useActionMutation("revoke-invite-link");

  if (isError) {
    return null;
  }

  const links: InviteLink[] = (data as { links: InviteLink[] } | undefined)?.links ?? [];

  return (
    <section className="rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Uitnodigingslink</h2>
        <Button
          type="button"
          size="sm"
          disabled={isPending}
          onClick={() => createLink({ taskId })}
        >
          {isPending ? "Bezig..." : "Link maken"}
        </Button>
      </div>

      {links.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Maak een link om iemand uit te nodigen om mee te werken in deze taak.
        </p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <li key={link.id} className="space-y-1">
              <Input
                readOnly
                aria-label={`Uitnodigingslink ${STATE_LABEL[link.state]}`}
                value={linkVoor(link.token)}
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{STATE_LABEL[link.state]}</span>
                <span>
                  verlopt {new Date(link.expiresAt).toLocaleString("nl-NL")}
                </span>
                {link.state === "geldig" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => revoke({ inviteId: link.id })}
                  >
                    Intrekken
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
