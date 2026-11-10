import assert from "node:assert/strict"
import { test } from "node:test"

import { resolveAppUrl } from "./app-url"

test("production keeps opening the real app", () => {
  assert.equal(resolveAppUrl({ isDemo: false }), "https://app.timely-plan.study")
  assert.equal(
    resolveAppUrl({ isDemo: false, appUrl: "https://app.timely-plan.study/" }),
    "https://app.timely-plan.study",
  )
})

test("in the demo build the landing opens the demo, never the real app", () => {
  assert.equal(
    resolveAppUrl({ isDemo: true, demoUrl: "https://demo.timely-plan.study" }),
    "https://demo.timely-plan.study",
  )
  // An app address copied over from production is ignored in the demo.
  assert.equal(
    resolveAppUrl({
      isDemo: true,
      appUrl: "https://app.timely-plan.study",
      demoUrl: "https://demo.timely-plan.study/",
    }),
    "https://demo.timely-plan.study",
  )
  // The demo's own address wins when it is given as the app address.
  assert.equal(
    resolveAppUrl({ isDemo: true, appUrl: "http://demo.localhost:3340" }),
    "http://demo.localhost:3340",
  )
  // Nothing configured: links stay on the same site.
  assert.equal(resolveAppUrl({ isDemo: true }), "")
})
