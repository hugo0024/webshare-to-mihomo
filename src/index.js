import { handleRequest } from "./converter.js";

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
