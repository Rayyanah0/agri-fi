import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

export async function injectApplicationSecrets(): Promise<void> {
  const secretId = process.env.APP_SECRET_SECRET_ID;
  if (!secretId) return;

  const mappings = (process.env.APP_SECRET_ENV_KEYS ?? '')
    .split(',')
    .map((rawEntry) => {
      const entry = rawEntry.trim();
      const separator = entry.indexOf('=');
      const target =
        separator === -1 ? entry : entry.slice(0, separator).trim();
      const source =
        separator === -1 ? target : entry.slice(separator + 1).trim();
      return { target, source };
    })
    .filter(({ target, source }) => target.length > 0 || source.length > 0);
  if (mappings.length === 0) {
    throw new Error(
      'APP_SECRET_ENV_KEYS is required when APP_SECRET_SECRET_ID is configured.',
    );
  }
  if (
    mappings.some(
      ({ target, source }) =>
        !/^[A-Z][A-Z0-9_]*$/.test(target) ||
        !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(source),
    )
  ) {
    throw new Error('APP_SECRET_ENV_KEYS contains an invalid key mapping.');
  }

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
  });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  const raw =
    response.SecretString ??
    (response.SecretBinary
      ? Buffer.from(response.SecretBinary).toString('utf8')
      : undefined);
  if (raw === undefined) {
    throw new Error(
      `Configured application secret "${secretId}" has no value.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Application secret must contain valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Application secret must be a JSON object.');
  }

  const secretValues = parsed as Record<string, unknown>;
  for (const { target, source } of mappings) {
    const value = secretValues[source];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        `Application secret is missing the configured key "${source}".`,
      );
    }
    process.env[target] = value;
  }
}
