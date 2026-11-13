import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import type { AlertVariableMap } from "./types.js";
import type { AttentionComposition, AttentionFacts } from "./attentionTypes.js";

interface OperatedConfig {
  version: 1;
  triggerIds: number[];
  composer: { path: string; sha256: string };
  declaration: { path: string; sha256: string };
}
interface Composer {
  validateDeclaration(declaration: unknown): void;
  composeKener(declaration: unknown, variables: AlertVariableMap, now: string, facts: unknown): AttentionComposition;
}

/** No configuration leaves the public fork independent. Broken configured inputs refuse opted sends. */
export async function loadAttentionComposer(triggerId: number) {
  const configPath = process.env.KENER_ATTENTION_CONFIG;
  if (!configPath) return null;
  const config = JSON.parse(await readFile(configPath, "utf8")) as OperatedConfig;
  if (
    config.version !== 1 ||
    !Array.isArray(config.triggerIds) ||
    config.triggerIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  )
    throw new Error("attention_configuration_invalid");
  if (!config.triggerIds.includes(triggerId)) return null;
  const readPinned = async (pin: OperatedConfig["composer"]) => {
    if (!pin || !isAbsolute(pin.path) || !/^[a-f0-9]{64}$/.test(pin.sha256)) throw new Error("attention_pin_invalid");
    const bytes = await readFile(pin.path);
    if (createHash("sha256").update(bytes).digest("hex") !== pin.sha256) throw new Error("attention_pin_mismatch");
    return bytes;
  };
  await readPinned(config.composer);
  const declaration = JSON.parse((await readPinned(config.declaration)).toString("utf8"));
  const url = pathToFileURL(config.composer.path);
  url.searchParams.set("sha256", config.composer.sha256);
  const composer = (await import(/* @vite-ignore */ url.href)) as Composer;
  composer.validateDeclaration(declaration);
  return {
    compose: (
      variables: AlertVariableMap,
      now: string,
      facts: AttentionFacts & { messages: unknown[]; deliveryUncertain?: boolean },
    ) => composer.composeKener(declaration, variables, now, facts),
  };
}
