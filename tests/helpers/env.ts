/**
 * Zet omgevingsvariabelen voor de duur van `run` en herstel daarna de
 * oorspronkelijke waarden, zodat tests de auth-omgeving kunnen variëren
 * zonder elkaar te beïnvloeden. Asynchrone `run` wordt afgewacht.
 */

export async function withEnv(
  values: Record<string, string | undefined>,
  run: () => void | Promise<void>,
): Promise<void> {
  const saved = new Map(
    Object.keys(values).map((key) => [key, process.env[key]] as const),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
