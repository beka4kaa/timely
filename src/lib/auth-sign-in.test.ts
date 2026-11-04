import assert from "node:assert/strict";
import { test } from "node:test";

import type { Account, Profile, User } from "next-auth";

import { authOptions } from "./auth";

function signIn(provider: string, profile?: Record<string, unknown>) {
  return authOptions.callbacks!.signIn!({
    user: { id: "1" } as User,
    account: { provider } as Account,
    profile: profile as Profile | undefined,
  });
}

test("Google must have verified the address, because the address is the identity", async () => {
  assert.equal(await signIn("google", { email: "a@example.com", email_verified: false }), false);
  assert.equal(await signIn("google", { email: "a@example.com", email_verified: true }), true);
});

test("password sign-in stays available", async () => {
  assert.equal(await signIn("credentials"), true);
});
