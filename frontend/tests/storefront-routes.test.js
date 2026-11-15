import test from "node:test";
import assert from "node:assert/strict";
import {
  productPath,
  legacyPublicPath,
  productIdFromPath,
} from "../src/utils/storefrontRoutes.js";

const id = "a0000000-0000-4000-8000-000000000001";
test("public URLs are stable, readable and free from fragments", () => {
  assert.equal(
    productPath({ id, name: 'Quesillo de café / 6"' }),
    `/products/${id}/quesillo-de-cafe-6`,
  );
  assert.equal(productIdFromPath(`/products/${id}/chocoflan`), id);
  assert.equal(productIdFromPath(`/products/${id}`), id);
  assert.equal(productIdFromPath("/products/invalid"), null);
});
test("old public bookmarks migrate while checkout, admin and page anchors stay intact", () => {
  assert.equal(legacyPublicPath("#catalog"), "/catalog");
  assert.equal(legacyPublicPath("#seasonal"), "/seasonal");
  assert.equal(legacyPublicPath(`#product/${id}`), `/products/${id}`);
  for (const hash of [
    "#cart",
    "#checkout",
    "#admin/login",
    "#about",
    "#contact",
    "#product/invalid",
  ])
    assert.equal(legacyPublicPath(hash), null);
});
