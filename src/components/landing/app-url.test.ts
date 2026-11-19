import assert from "node:assert/strict"
import { test } from "node:test"

import { resolveAppUrl } from "./app-url"

test("production keeps opening the real app", () => {
  assert.equal(resolveAppUrl({ isDemo: false }), "https://app.timely-plan.com")
  assert.equal(
    resolveAppUrl({ isDemo: false, appUrl: "https://app.timely-plan.com/" }),
    "https://app.timely-plan.com",
  )
})

test("in the demo build the landing opens the demo, never the real app", () => {
  assert.equal(
    resolveAppUrl({ isDemo: true, demoUrl: "https://demo.timely-plan.com" }),
    "https://demo.timely-plan.com",
  )
  // An app address copied over from production is ignored in the demo.
  assert.equal(
    resolveAppUrl({
      isDemo: true,
      appUrl: "https://app.timely-plan.com",
      demoUrl: "https://demo.timely-plan.com/",
    }),
    "https://demo.timely-plan.com",
  )
  // The demo's own address wins when it is given as the app address.
  assert.equal(
    resolveAppUrl({ isDemo: true, appUrl: "http://demo.localhost:3340" }),
    "http://demo.localhost:3340",
  )
  // Nothing configured: links stay on the same site.
  assert.equal(resolveAppUrl({ isDemo: true }), "")
})
