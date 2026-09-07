import { handleStatus } from "../server/handlers.ts";

export function GET() {
  return Response.json(handleStatus());
}
