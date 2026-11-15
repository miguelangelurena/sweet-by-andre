import test from "node:test";
import assert from "node:assert/strict";
import { initialProductVariant } from "../src/utils/productVariants.js";

test("opening a product selects the price advertised by From regardless of creation order", () => {
  const variants = [
    { id: "large", price: "42.99" },
    { id: "small", price: "8.99" },
    { id: "medium", price: "19.99" },
  ];
  assert.equal(initialProductVariant(variants).id, "small");
  assert.deepEqual(
    variants.map((variant) => variant.id),
    ["large", "small", "medium"],
  );
});

test("default selection preserves ties and never selects unavailable or invalid prices", () => {
  const first = { id: "first", price: "6.99" };
  assert.equal(
    initialProductVariant([
      null,
      { price: "bad" },
      { price: "0" },
      { price: "1.99", is_available: false },
      first,
      { id: "tie", price: 6.99 },
    ]),
    first,
  );
  assert.equal(initialProductVariant([]), null);
  assert.equal(initialProductVariant([{ price: -1 }]), null);
});
