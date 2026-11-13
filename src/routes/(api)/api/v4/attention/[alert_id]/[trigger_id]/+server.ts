import { json, type RequestHandler } from "@sveltejs/kit";
import {
  AttentionOperationError,
  ReadAttention,
  ChangeAttention,
  EvaluateAttention,
} from "$lib/server/controllers/attentionController";

const failure = (error: unknown, effect: string) =>
  error instanceof AttentionOperationError
    ? json({ error: error.code }, { status: error.status })
    : json(
        { error: `attention_${effect}_unobserved`, next: "Read the exact record before retrying." },
        { status: 503 },
      );

/** The existing /api/v4 bearer hook protects all three actions. */
export const GET: RequestHandler = async ({ params }) => {
  try {
    return json(await ReadAttention(params));
  } catch (error) {
    return failure(error, "read");
  }
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  try {
    return json(await ChangeAttention(params, await request.json()));
  } catch (error) {
    return failure(error, "write");
  }
};

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    return json(await EvaluateAttention(params, await request.json()));
  } catch (error) {
    return failure(error, "evaluation");
  }
};
