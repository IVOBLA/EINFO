import { config } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "..");
const envFiles = [".env", ".ENV", "dot.env"];
let loaded = false;

for (const file of envFiles) {
  const envPath = path.join(serverRoot, file);
  if (existsSync(envPath)) {
    config({ path: envPath, override: true });
    loaded = true;
  }
}

if (!loaded) {
  config();
}
