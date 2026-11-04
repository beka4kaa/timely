import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

const TOKEN_ROUTE = "/api/auth/backend-token";
const API_URL = "https://api.example.com/api/things/";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const issued = (token: string, expiresIn = 600) =>
  json({ token, expiresIn });

let calls: { url: string; init: RequestInit }[];
let assigned: string[];
let storageListener: ((event: { key: string }) => void) | undefined;

function setWindow(pathname: string) {
  (globalThis as any).window = {
    location: { pathname, search: "?x=1", assign: (url: string) => assigned.push(url) },
    addEventListener: (_: string, listener: (event: { key: string }) => void) => {
      storageListener = listener;
    },
  };
}

/** Each test gets its own copy: the module keeps the token in memory. */
function load(handler: Handler) {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  const path = require.resolve("./auth-fetch");
  delete require.cache[path];
  return require("./auth-fetch") as typeof import("./auth-fetch");
}

const tokenCalls = () => calls.filter((call) => call.url === TOKEN_ROUTE);
const apiCalls = () => calls.filter((call) => call.url === API_URL);
const sent = (call: { init: RequestInit }) => call.init.headers as Record<string, string>;

beforeEach(() => {
  calls = [];
  assigned = [];
  storageListener = undefined;
  setWindow("/dashboard/plan");
});

test("sends the token and asks the server for one only once", async () => {
  const { authFetch } = load((url) =>
    url === TOKEN_ROUTE ? issued("t1") : json([]),
  );

  await authFetch(API_URL);
  await authFetch(API_URL);

  assert.equal(tokenCalls().length, 1);
  assert.equal(apiCalls().length, 2);
  assert.equal(sent(apiCalls()[1]).Authorization, "Bearer t1");
});

test("calls that start together share one token request", async () => {
  const { authFetch } = load((url) =>
    url === TOKEN_ROUTE ? issued("t1") : json([]),
  );

  await Promise.all([authFetch(API_URL), authFetch(API_URL), authFetch(API_URL)]);

  assert.equal(tokenCalls().length, 1);
});

test("renews a token that is about to run out", async () => {
  let n = 0;
  const { authFetch } = load((url) =>
    url === TOKEN_ROUTE ? issued(`t${++n}`, 30) : json([]),
  );

  await authFetch(API_URL);
  await authFetch(API_URL);

  assert.equal(tokenCalls().length, 2);
  assert.equal(sent(apiCalls()[1]).Authorization, "Bearer t2");
});

test("a rejected token is renewed and the call repeated once", async () => {
  let n = 0;
  const { authFetch } = load((url, init) => {
    if (url === TOKEN_ROUTE) return issued(`t${++n}`);
    return (init.headers as Record<string, string>).Authorization === "Bearer t1"
      ? json({}, 401)
      : json({ ok: true });
  });

  const response = await authFetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ a: 1 }),
  });

  assert.equal(response.status, 200);
  assert.equal(apiCalls().length, 2);
  assert.equal(apiCalls()[1].init.body, JSON.stringify({ a: 1 }));
  assert.deepEqual(assigned, []);
});

test("a fresh token that is also rejected is returned, not retried forever", async () => {
  const { authFetch } = load((url) =>
    url === TOKEN_ROUTE ? issued("t") : json({}, 401),
  );

  const response = await authFetch(API_URL);

  assert.equal(response.status, 401);
  assert.equal(apiCalls().length, 2);
  // Signing in again can't fix a backend that rejects good tokens, and a Google
  // session would come straight back here.
  assert.deepEqual(assigned, []);
});

test("a signed-out caller is sent to sign in and comes back afterwards", async () => {
  const { authFetch } = load((url) =>
    url === TOKEN_ROUTE ? json({}, 401) : json({}, 401),
  );

  const response = await authFetch(API_URL);

  assert.equal(response.status, 401);
  assert.equal(sent(apiCalls()[0]).Authorization, undefined);
  assert.equal(apiCalls().length, 1);
  assert.deepEqual(assigned, [
    `/auth/signin?callbackUrl=${encodeURIComponent("/dashboard/plan?x=1")}`,
  ]);
});

test("the sign-in page never redirects to itself", async () => {
  setWindow("/auth/signin");
  const { authFetch } = load((url) =>
    url === TOKEN_ROUTE ? json({}, 401) : json({}, 401),
  );

  await authFetch(API_URL);

  assert.deepEqual(assigned, []);
});

test("signing in later is noticed: a signed-out answer is not kept", async () => {
  let signedIn = false;
  const { authFetch } = load((url) => {
    if (url !== TOKEN_ROUTE) return json([]);
    return signedIn ? issued("t1") : json({}, 401);
  });

  await authFetch(API_URL);
  signedIn = true;
  await authFetch(API_URL);

  assert.equal(sent(apiCalls()[1]).Authorization, "Bearer t1");
});

test("an unconfigured token route sends no identity, and no one to sign in", async () => {
  const { authFetch } = load((url) =>
    url === TOKEN_ROUTE ? json({ error: "Not configured" }, 503) : json({}, 401),
  );

  const response = await authFetch(API_URL);

  assert.equal(response.status, 401);
  assert.equal(sent(apiCalls()[0]).Authorization, undefined);
  assert.deepEqual(assigned, []);
});

test("a failing token route doesn't break the call and is retried next time", async () => {
  let up = false;
  const { authFetch } = load((url) => {
    if (url !== TOKEN_ROUTE) return json([]);
    if (!up) throw new TypeError("network");
    return issued("t1");
  });

  const first = await authFetch(API_URL);
  up = true;
  await authFetch(API_URL);

  assert.equal(first.status, 200);
  assert.equal(sent(apiCalls()[1]).Authorization, "Bearer t1");
});

test("signing out in another tab drops the token here", async () => {
  let n = 0;
  const { authFetch } = load((url) =>
    url === TOKEN_ROUTE ? issued(`t${++n}`) : json([]),
  );

  await authFetch(API_URL);
  storageListener?.({ key: "nextauth.message" });
  await authFetch(API_URL);

  assert.equal(sent(apiCalls()[1]).Authorization, "Bearer t2");
});

test("a token already on its way when another tab signs out is not kept", async () => {
  let n = 0;
  let release: (() => void) | undefined;
  const { authFetch } = load(async (url) => {
    if (url !== TOKEN_ROUTE) return json([]);
    n += 1;
    if (n === 1) await new Promise<void>((resolve) => (release = resolve));
    return issued(`t${n}`);
  });

  const first = authFetch(API_URL);
  await new Promise((resolve) => setImmediate(resolve));
  storageListener?.({ key: "nextauth.message" });
  release?.();
  await first;
  await authFetch(API_URL);

  assert.equal(tokenCalls().length, 2);
  assert.equal(sent(apiCalls()[1]).Authorization, "Bearer t2");
});

test("headers from the caller keep working", async () => {
  const { authFetch } = load((url) =>
    url === TOKEN_ROUTE ? issued("t1") : json([]),
  );

  await authFetch(API_URL);
  await authFetch(API_URL, { headers: { "Content-Type": "text/plain", "X-Other": "1" } });

  assert.equal(sent(apiCalls()[0])["Content-Type"], "application/json");
  assert.equal(sent(apiCalls()[1])["Content-Type"], "text/plain");
  assert.equal(sent(apiCalls()[1])["X-Other"], "1");
  assert.equal(sent(apiCalls()[1]).Authorization, "Bearer t1");
});

test("backendAuthHeaders gives an XHR the same identity", async () => {
  const { backendAuthHeaders } = load(() => issued("t1"));

  assert.deepEqual(await backendAuthHeaders(), {
    Authorization: "Bearer t1",
  });
});
