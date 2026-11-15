// The public API already filters purchasable configurations. Starting at the
// lowest valid price keeps the detail page consistent with the catalog's From.
export function initialProductVariant(variants = []) {
  return variants.reduce((best, variant) => {
    const price = Number(variant?.price);
    if (
      !variant ||
      variant.is_available === false ||
      !Number.isFinite(price) ||
      price <= 0
    )
      return best;
    return !best || price < Number(best.price) ? variant : best;
  }, null);
}
