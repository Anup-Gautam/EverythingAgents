import dotenv from "dotenv";
import path from "node:path";

const backendRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
if (cred && !path.isAbsolute(cred)) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(backendRoot, cred);
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function getPort(): number {
  const raw = process.env.PORT?.trim() || "8080";
  const port = Number(raw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}
