import { handleRobots } from "../src/server/seo/handlers";

export const config = { runtime: "edge" };

export default function handler(request: Request): Response {
  return handleRobots(request, { env: { SITE_URL: process.env.VITE_SITE_URL }, fetch });
}
