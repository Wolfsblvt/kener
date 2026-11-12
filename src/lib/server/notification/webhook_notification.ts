import type { WebhookTemplateJson } from "../types/db";
import { describeError } from "./notification_utils.js";
import { ApplySecretsToHeaders, GetRequiredSecrets, ReplaceAllOccurrences } from "../tool.js";
import Mustache from "mustache";
import type { SiteDataForNotification, TemplateVariableMap } from "./types.js";
import version from "../../version.js";

/** Configuration refused before HTTP submission, without retaining raw header/parser values. */
export class InvalidWebhookHeadersError extends Error {
  constructor() {
    super("Invalid webhook headers");
    this.name = "InvalidWebhookHeadersError";
  }
}

/** Parse the stored header array and validate HTTP names/values through the native Headers contract. */
export function parseWebhookHeaders(
  headers?: string,
  secrets: Array<{ find: string; replace: string | undefined }> = [],
): Record<string, string> {
  try {
    const parsed = headers ? JSON.parse(headers) : [];
    if (!Array.isArray(parsed)) throw new InvalidWebhookHeadersError();
    const result = new Headers({
      "user-agent": `Kener/${version()}`,
      accept: "application/json",
      "content-type": "application/json",
    });
    for (const header of parsed) {
      if (!header || typeof header.key !== "string" || !header.key || typeof header.value !== "string")
        throw new InvalidWebhookHeadersError();
    }
    // Use the existing field-level substitution path: quotes/backslashes in valid
    // credential values must not corrupt serialized header JSON.
    for (const [key, value] of Object.entries(ApplySecretsToHeaders(parsed, secrets))) result.set(key, value);
    return Object.fromEntries(result.entries());
  } catch {
    throw new InvalidWebhookHeadersError();
  }
}

export default async function send(
  webhookBody: string,
  variables: Record<string, string | number | boolean>,
  webhookURL: string,
  headers?: string,
) {
  // Process trigger meta for environment secrets
  let envSecrets = GetRequiredSecrets(webhookBody + headers + webhookURL);

  for (let i = 0; i < envSecrets.length; i++) {
    const secret = envSecrets[i];
    if (secret.replace !== undefined) {
      webhookBody = ReplaceAllOccurrences(webhookBody, secret.find, secret.replace);
      webhookURL = ReplaceAllOccurrences(webhookURL, secret.find, secret.replace);
    }
  }

  // Validate again after secret interpolation: an interpolated invalid value must also refuse before fetch.
  const headersObj = parseWebhookHeaders(headers, envSecrets);

  // Render the webhook body with Mustache (disable HTML escaping for JSON/plain text)
  const renderedBody = Mustache.render(webhookBody, { ...variables }, {}, { escape: (text) => text });

  let responseStatus: number | undefined;
  try {
    const response = await fetch(webhookURL, {
      method: "POST",
      headers: headersObj,
      body: renderedBody,
    });

    responseStatus = response.status;
    if (!response.ok) {
      const errorText = await response.text();
      return {
        error: `Webhook request failed with status ${response.status}`,
        status: response.status,
        details: errorText,
      };
    }

    const responseData = await response.text();
    return { success: true, status: response.status, data: responseData };
  } catch (error) {
    return { error: `Error sending webhook: ${describeError(error)}`, status: responseStatus, details: error };
  }
}
