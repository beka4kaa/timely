import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { jwtVerify } from "jose";

import {
  BACKEND_TOKEN_TTL_SECONDS,
  backendIdentityHeaders,
  mintBackendToken,
} from "./backend-token";

const SECRET = "test-only-secret-long-enough-for-hs256";
const key = new TextEncoder().encode(SECRET);
const original = process.env.TIMELY_API_JWT_SECRET;

afterEach(() => {
  if (original === undefined) delete process.env.TIMELY_API_JWT_SECRET;
  else process.env.TIMELY_API_JWT_SECRET = original;
});

test("the token carries what the backend checks", async () => {
  process.env.TIMELY_API_JWT_SECRET = SECRET;
  const token = await mintBackendToken("student@example.com");
  assert.ok(token);

  const { payload, protectedHeader } = await jwtVerify(token, key, {
    issuer: "timely-web",
    audience: "timely-api",
    algorithms: ["HS256"],
  });

  assert.equal(protectedHeader.alg, "HS256");
  assert.equal(payload.sub, "student@example.com");
  assert.equal((payload.exp as number) - (payload.iat as number), BACKEND_TOKEN_TTL_SECONDS);
});

test("the address is signed exactly as the session has it", async () => {
  process.env.TIMELY_API_JWT_SECRET = SECRET;
  const token = await mintBackendToken("Mixed.Case@Example.com");
  const { payload } = await jwtVerify(token as string, key);

  assert.equal(payload.sub, "Mixed.Case@Example.com");
});

test("without a secret there is no token, and the rollout header still goes out", async () => {
  delete process.env.TIMELY_API_JWT_SECRET;

  assert.equal(await mintBackendToken("student@example.com"), null);
  assert.deepEqual(await backendIdentityHeaders("student@example.com"), {
    "X-User-Email": "student@example.com",
  });
});

test("with a secret both go out during the rollout", async () => {
  process.env.TIMELY_API_JWT_SECRET = SECRET;

  const headers = await backendIdentityHeaders("student@example.com");

  assert.match(headers.Authorization, /^Bearer /);
  assert.equal(headers["X-User-Email"], "student@example.com");
});
