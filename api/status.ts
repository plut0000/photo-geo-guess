import { handleStatus } from "../server/handlers.js";

export function GET() {
  return Response.json(handleStatus());
}
