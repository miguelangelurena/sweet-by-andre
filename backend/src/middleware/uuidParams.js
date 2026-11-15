const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function installUuidParams(router) {
  for (const name of [
    "id",
    "productId",
    "orderId",
    "optionId",
    "valueId",
    "imageId",
  ])
    router.param(name, (_req, res, next, value) =>
      UUID.test(value)
        ? next()
        : res.status(400).json({ status: "ERROR", message: `Invalid ${name}` }),
    );
}
