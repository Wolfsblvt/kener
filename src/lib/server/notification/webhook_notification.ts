import type { WebhookTemplateJson } from "../types/db";
import { describeError } from "./notification_utils.js";
import { GetRequiredSecrets, ReplaceAllOccurrences } from "../tool.js";
import Mustache from "mustache";
import type { SiteDataForNotification, TemplateVariableMap } from "./types.js";
import version from "../../version.js";

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
      if (headers) {
        headers = ReplaceAllOccurrences(headers, secret.find, secret.replace);
      }
    }
  }

  const defaultHeaders = [
    { key: "user-agent", value: `Kener/${version()}` },
    { key: "accept", value: "application/json" },
    { key: "content-type", value: "application/json" },
  ];

  try {
    if (headers) {
      const parsedHeaders: Array<{ key: string; value: string }> = JSON.parse(headers);
      for (const header of parsedHeaders) {
        //if key exist in defaultHeaders, replace the value
        const existingHeader = defaultHeaders.find((h) => h.key.toLowerCase() === header.key.toLowerCase());
        if (existingHeader) {
          existingHeader.value = header.value;
        } else {
          defaultHeaders.push(header);
        }
      }
    }
  } catch (e) {
    // The caller receives the result; raw configuration/parser errors must not enter logs.
  }

  // Render the webhook body with Mustache (disable HTML escaping for JSON/plain text)
  const renderedBody = Mustache.render(webhookBody, { ...variables }, {}, { escape: (text) => text });

  // Build headers object
  const headersObj: Record<string, string> = {};

  for (const header of defaultHeaders) {
    if (header.key && header.value) {
      headersObj[header.key] = header.value;
    }
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
    return { success: true, status: response.status, data: responseData };
  } catch (error) {
    return { error: `Error sending webhook: ${describeError(error)}`, status: responseStatus, details: error };
  }
}
