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
  composedText?: string,
) {
  // The opted-in sender owns message meaning. Keep only the existing recipient/
  // routing envelope, before template expansion can corrupt a quoted old sentence.
  if (composedText !== undefined) {
    const body = JSON.parse(webhookBody);
    if (!body || typeof body !== "object" || Array.isArray(body) || !body.chat_id)
      throw new Error("attention_recipient_missing");
    body.text = "";
    delete body.parse_mode;
    delete body.entities;
    webhookBody = JSON.stringify(body);
  }
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
  let renderedBody = Mustache.render(webhookBody, { ...variables }, {}, { escape: (text) => text });
  if (composedText !== undefined) {
    const url = new URL(webhookURL);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "api.telegram.org" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/bot[^/]+\/sendMessage$/.test(url.pathname)
    )
      throw new Error("attention_channel_unqualified");
    renderedBody = JSON.stringify({ ...JSON.parse(renderedBody), text: composedText });
  }

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
    let attentionSubmitted = false;
    if (composedText !== undefined) {
      try {
        const submitted = JSON.parse(renderedBody);
        const receipt = JSON.parse(responseData);
        attentionSubmitted =
          receipt.ok === true &&
          Number.isSafeInteger(receipt.result?.message_id) &&
          receipt.result.message_id > 0 &&
          Number.isSafeInteger(receipt.result?.date) &&
          String(receipt.result?.chat?.id) === String(submitted.chat_id) &&
          receipt.result?.text === composedText;
      } catch {
        /* An unusable body cannot establish message submission. */
      }
    }
    return { success: true, status: response.status, data: responseData, attentionSubmitted };
  } catch (error) {
    return { error: `Error sending webhook: ${describeError(error)}`, status: responseStatus, details: error };
  }
}
