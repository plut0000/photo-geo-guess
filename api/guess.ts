import { handleGuess, type GuessRequest } from "../server/handlers.js";

export const maxDuration = 60;

export async function POST(request: Request) {
  let body: GuessRequest;
  try {
    body = (await request.json()) as GuessRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const result = await handleGuess(body);
  return Response.json(result.body, { status: result.status });
}
