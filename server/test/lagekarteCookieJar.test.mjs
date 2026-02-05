import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  if (start < 0) throw new Error(`Function ${functionName} not found`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${functionName}`);
}

const serverPath = path.resolve(process.cwd(), "server.js");
const source = fs.readFileSync(serverPath, "utf8");
const fnNames = [
  "parseSetCookie",
  "splitSetCookieHeader",
  "getSetCookieValues",
  "storeSetCookieInJar",
  "buildCookieHeaderForJar",
];
const scriptSource = `${fnNames.map((name) => extractFunctionSource(source, name)).join("\n\n")}\nmodule.exports = { ${fnNames.join(", ")} };`;
const sandbox = { module: { exports: {} }, exports: {}, Date, String, Number, Array };
vm.createContext(sandbox);
new vm.Script(scriptSource).runInContext(sandbox);

const { storeSetCookieInJar, buildCookieHeaderForJar } = sandbox.module.exports;

test("storeSetCookieInJar nutzt getSetCookie und Cookie-Header enthält beide Cookies", () => {
  const jar = { cookies: new Map() };
  const headers = {
    getSetCookie: () => [
      "PHPSESSID=abc; Path=/; HttpOnly",
      "XSRF-TOKEN=xyz; Path=/",
    ],
  };

  storeSetCookieInJar(jar, headers);

  assert.equal(jar.cookies.size, 2);
  const cookieHeader = buildCookieHeaderForJar(jar, "/");
  assert.match(cookieHeader, /PHPSESSID=abc/);
  assert.match(cookieHeader, /XSRF-TOKEN=xyz/);
});
