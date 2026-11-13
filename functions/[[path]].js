import { handleRequest } from "../src/converter.js";

export async function onRequest({ request, env }) {
  return handleRequest(request, env);
}
