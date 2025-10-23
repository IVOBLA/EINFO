import { config } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "..");
const envPath = path.join(serverRoot, ".env");

if (existsSync(envPath)) {
  config({ path: envPath });
} else {
  config();
}