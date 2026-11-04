import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";

const nextConfig = require("../../next.config.js");

const API_DIR = join(__dirname, "..", "app", "api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [path] : [];
  });
}

/** `/api/blocks/[id]/timer`, with each dynamic segment filled in. */
function sampleUrl(file: string): string {
  const parts = relative(API_DIR, file).split(sep).slice(0, -1);
  return ["/api", ...parts.map((part) => (part.startsWith("[") ? "sample" : part))].join("/");
}

function matcher(source: string): RegExp {
  const pattern = source.replace(/:path\*/g, ".*").replace(/:path\+/g, ".+");
  return new RegExp(`^${pattern}$`);
}

test("no rewrite to Django shadows a Next route with a dynamic segment", async () => {
  // Next checks these rewrites before dynamic routes. A rewrite can't add the
  // caller's identity, so a shadowed handler would never run and the backend
  // would answer 401.
  const rewrites: { source: string; destination: string }[] = await nextConfig.rewrites();
  const toBackend = rewrites.filter(({ destination }) => !destination.startsWith("/"));
  const dynamicRoutes = routeFiles(API_DIR).filter((file) => file.includes("["));
  assert.ok(toBackend.length > 0 && dynamicRoutes.length > 0);

  for (const file of dynamicRoutes) {
    const url = sampleUrl(file);
    for (const { source } of toBackend) {
      assert.ok(!matcher(source).test(url), `${source} shadows ${url}`);
    }
  }
});
