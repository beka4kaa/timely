import assert from "node:assert/strict"
import { test } from "node:test"

import { DOCK_BELOW, GAP, MARGIN, holeFor, placeCard, veilPath } from "./tour-geometry"
import { demoLandingPath, newDemoVisitor, pickDemoLang, withTourFlag } from "../../lib/demo-mode"

const desktop = { width: 1280, height: 800 }
const card = { width: 360, height: 180 }

test("the hole is padded and clipped to the screen", () => {
  const hole = holeFor({ top: 2, left: 2, width: 100, height: 40 }, desktop)
  assert.equal(hole.top, MARGIN / 2)
  assert.equal(hole.left, MARGIN / 2)
  assert.equal(hole.width, 100 + 2 + 8 - MARGIN / 2)
})

test("the card goes under the target when it fits", () => {
  const hole = { top: 100, left: 300, width: 400, height: 120 }
  const spot = placeCard(hole, card, desktop)
  assert.equal(spot.placement, "below")
  assert.equal(spot.top, 100 + 120 + GAP)
  assert.equal(spot.left, 300 + 200 - 180)
})

test("the card goes above a target near the bottom", () => {
  const hole = { top: 640, left: 500, width: 200, height: 60 }
  const spot = placeCard(hole, card, desktop)
  assert.equal(spot.placement, "above")
  assert.equal(spot.top, 640 - GAP - card.height)
})

test("a tall target gets the card over its lower corner, inside the screen", () => {
  const hole = { top: 40, left: 260, width: 980, height: 720 }
  const spot = placeCard(hole, card, desktop)
  assert.equal(spot.placement, "over")
  assert.ok(spot.left + card.width <= desktop.width - MARGIN)
  assert.ok(spot.top + card.height <= desktop.height - MARGIN)
})

test("the card never leaves the screen sideways", () => {
  const spot = placeCard({ top: 100, left: 1200, width: 60, height: 40 }, card, desktop)
  assert.equal(spot.left, desktop.width - card.width - MARGIN)
  const leftEdge = placeCard({ top: 100, left: 0, width: 40, height: 40 }, card, desktop)
  assert.equal(leftEdge.left, MARGIN)
})

test("without a target the card is centred", () => {
  const spot = placeCard(null, card, desktop)
  assert.equal(spot.placement, "center")
  assert.equal(spot.left, (desktop.width - card.width) / 2)
})

test("on a phone the card docks above the tab bar", () => {
  const phone = { width: DOCK_BELOW - 250, height: 800 }
  const spot = placeCard({ top: 100, left: 10, width: 300, height: 100 }, card, phone, 90)
  assert.equal(spot.placement, "dock")
  assert.equal(spot.left, MARGIN)
  assert.equal(spot.top, 800 - 90 - card.height - MARGIN)
})

test("exactly 640 px already docks, like the CSS that hides the sidebar", () => {
  assert.equal(placeCard(null, card, { width: DOCK_BELOW, height: 800 }).placement, "dock")
  assert.equal(placeCard(null, card, { width: DOCK_BELOW + 1, height: 800 }).placement, "center")
})

test("the veil cuts the hole out with evenodd subpaths", () => {
  const plain = veilPath(null, desktop)
  assert.equal(plain, "M0 0H1280V800H0Z")
  const cut = veilPath({ top: 10, left: 20, width: 100, height: 50 }, desktop, 16)
  assert.ok(cut.startsWith(plain))
  assert.equal((cut.match(/M/g) ?? []).length, 2)
})

test("a visitor identity matches the backend's pattern", () => {
  const visitor = newDemoVisitor("0b7c6a7e-1d2f-4a51-9c3e-5f0a1b2c3d4e")
  assert.match(visitor.email, /^visitor-[0-9a-f-]{8,64}@demo\.timely-plan\.study$/)
  assert.equal(visitor.id, "demo-0b7c6a7e-1d2f-4a51-9c3e-5f0a1b2c3d4e")
})

test("only own relative paths survive as the place to land", () => {
  assert.equal(demoLandingPath("/chat?x=1"), "/chat?x=1")
  assert.equal(demoLandingPath("https://evil.example/"), "/")
  assert.equal(demoLandingPath("//evil.example/x"), "/")
  assert.equal(demoLandingPath("/\\evil.example"), "/")
  assert.equal(demoLandingPath("/auth/signin"), "/")
  assert.equal(demoLandingPath(null), "/")
})

test("the tour flag keeps other parameters and the hash", () => {
  assert.equal(withTourFlag("/"), "/?tour=1")
  assert.equal(withTourFlag("/chat?chat=5"), "/chat?chat=5&tour=1")
  assert.equal(withTourFlag("/plan#today"), "/plan?tour=1#today")
})

test("Russian for ru and kk browsers, English otherwise", () => {
  assert.equal(pickDemoLang(["ru-RU", "en"]), "ru")
  assert.equal(pickDemoLang(["en-US", "kk"]), "ru")
  assert.equal(pickDemoLang(["en-US", "de"]), "en")
  assert.equal(pickDemoLang(undefined), "en")
})
