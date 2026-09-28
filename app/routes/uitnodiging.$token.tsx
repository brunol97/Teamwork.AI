import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Uitnodiging — ${APP_TITLE}` }];
}

type Preview = {
  token: string;
  state: "geldig" | "verlopen" | "ingetrokken";
  melding: string;
  taskTitle: string | null;
};

/**
 * Landingspagina van een uitnodigingslink. Een geldige link laat de tweede
 * persoon meteen binnengaan en stuurt hem door naar de taak, zonder
 * keuzescherm. Een verlopen of ingetrokken link toont de melding van de link.
 */
export default function InviteLinkRoute() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useActionQuery(
    "get-invite-link",
    { token: token ?? "" },
    { enabled: Boolean(token), retry: false },
  );
  const { mutate: accept, isPending } = useActionMutation("accept-invite-link");
  const [foutmelding, setFoutmelding] = useState<string | null>(null);
  const gestart = useRef(false);

  const preview = data as Preview | undefined;

  useEffect(() => {
    if (preview?.state !== "geldig" || gestart.current) return;
    gestart.current = true;
    accept(
      { token: token ?? "" },
      {
        onSuccess: (result) => navigate(result.redirect),
        onError: (error) => setFoutmelding(error.message),
      },
    );
  }, [preview?.state, token]);

  const melding = foutmelding ?? preview?.melding ?? null;

  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="mb-4 text-2xl font-semibold">Uitnodiging</h1>

      {melding ? (
        <div
          role="alert"
          data-testid="uitnodiging-melding"
          className="rounded-lg border p-4 text-sm"
        >
          {melding}
        </div>
      ) : isLoading || isPending ? (
        <p data-testid="uitnodiging-laden">Je wordt binnengelaten...</p>
      ) : (
        <p>
          Je wordt binnengelaten in <strong>{preview?.taskTitle}</strong>...
        </p>
      )}
    </div>
  );
}
