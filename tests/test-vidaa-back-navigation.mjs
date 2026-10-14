import assert from "node:assert/strict";
import { getVidaaPlayerBackTarget } from "../js/platform/vidaa/vidaaBackNavigation.js";

// Continue Watching: Home -> Sources -> Player returns to Home.
assert.deepEqual(getVidaaPlayerBackTarget(["home", { route: "stream", params: { itemId: "tt1" } }]), { route: "home", params: {} });

// Detail -> Sources -> Player returns to the same Detail.
assert.deepEqual(
  getVidaaPlayerBackTarget([
    "home",
    { route: "detail", params: { itemId: "tt1", itemType: "series" } },
    { route: "stream", params: { itemId: "tt1" } }
  ]),
  { route: "detail", params: { itemId: "tt1", itemType: "series" } }
);

// Sources is not on top (player opened directly): keep the default behaviour.
assert.equal(getVidaaPlayerBackTarget(["home", { route: "detail", params: {} }]), null);

// Nothing below Sources, or an unknown screen below it.
assert.equal(getVidaaPlayerBackTarget([{ route: "stream", params: {} }]), null);
assert.equal(getVidaaPlayerBackTarget(["settings", { route: "stream", params: {} }]), null);
assert.equal(getVidaaPlayerBackTarget(null), null);

console.log("VIDAA back navigation checks passed.");
