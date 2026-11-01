import dotenv from "dotenv";
import { pathToFileURL } from "node:url";
import { pool } from "../src/config/database.js";
import { readDeliverySettings } from "../src/services/delivery.service.js";
import {
  feeForMeters,
  feeForZip,
  normalizeZip,
  deliveryPricingMethod,
} from "../src/services/deliveryPolicy.service.js";
import { roadDistance } from "../src/services/roadDistance.service.js";

dotenv.config({ quiet: true });

// A read-only check. A destination makes one Routes API request, but does not
// create a customer/cart/order, store a quote, or change delivery activation.
export async function checkDelivery({
  db = pool,
  env = process.env,
  destination,
  zipCode,
  measure = roadDistance.measure,
} = {}) {
  const { config } = await readDeliverySettings(db);
  const result = {
    pricing_method: deliveryPricingMethod(config),
    zip_rates: config.zip_rates ?? [],
    zip_tested: false,
    origin_configured: Boolean(config.origin_address?.trim()),
    routing_key_configured: Boolean(env.GOOGLE_ROUTES_API_KEY?.trim()),
    delivery_enabled: config.delivery_enabled,
    minimum_subtotal_cents: config.minimum_subtotal_cents,
    minimum_scope: config.minimum_scope,
    rates: config.rates,
    route_tested: false,
  };
  result.ready =
    result.pricing_method === "zip_code"
      ? result.zip_rates.length > 0
      : result.origin_configured && result.routing_key_configured;
  if (result.pricing_method === "zip_code") {
    return result.ready && zipCode
      ? {
          ...result,
          zip_tested: true,
          zip_code: normalizeZip(zipCode),
          fee_cents: feeForZip(zipCode, result.zip_rates),
        }
      : result;
  }
  if (!result.ready || !destination) return result;
  const meters = await measure(config.origin_address, destination);
  return {
    ...result,
    route_tested: true,
    distance_meters: meters,
    distance_miles: meters / 1609.344,
    fee_cents: feeForMeters(meters, config.rates),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = process.argv.slice(2);
    if (
      args.length &&
      (!["--destination", "--zip"].includes(args[0]) ||
        args.length !== 2 ||
        !args[1].trim() ||
        args[1].length > 500)
    ) {
      console.error(
        'Uso: npm.cmd run delivery:check [-- --zip "ZIP"] o [-- --destination "Dirección completa de prueba"]',
      );
      process.exitCode = 1;
    } else {
      const result = await checkDelivery({
        destination: args[0] === "--destination" ? args[1]?.trim() : undefined,
        zipCode: args[0] === "--zip" ? args[1]?.trim() : undefined,
      });
      console.log(
        `Método de tarifa: ${result.pricing_method === "zip_code" ? "ZIP codes (sin Google ni tarjeta)" : "millas por carretera"}`,
      );
      if (result.pricing_method === "road_distance") {
        console.log(
          `Dirección de salida: ${result.origin_configured ? "configurada (privada)" : "pendiente en administración"}`,
        );
        console.log(
          `Clave de Google Routes: ${result.routing_key_configured ? "configurada; su acceso se comprueba al medir una ruta" : "pendiente en GOOGLE_ROUTES_API_KEY"}`,
        );
      }
      console.log(
        `Delivery en la tienda: ${result.delivery_enabled ? "activado" : "desactivado"}`,
      );
      console.log(
        `Compra mínima: $${(result.minimum_subtotal_cents / 100).toFixed(2)} (${result.minimum_scope === "delivery" ? "solo delivery" : "delivery y pickup"})`,
      );
      if (result.pricing_method === "zip_code") {
        console.log(
          `${result.zip_rates.length} ZIP codes con tarifa configurada.`,
        );
        if (!result.ready) {
          console.log(
            "Añade las tarifas de ZIP en administración. No se asignan precios automáticamente.",
          );
          process.exitCode = 2;
        } else if (!result.zip_tested)
          console.log(
            'Añade --zip "ZIP" para comprobar una tarifa guardada. No se llamó a Google.',
          );
        else
          console.log(
            result.fee_cents === null
              ? `ZIP ${result.zip_code}: cotización personalizada o pickup.`
              : `ZIP ${result.zip_code}: tarifa $${(result.fee_cents / 100).toFixed(2)}.`,
          );
      } else if (!result.ready) {
        console.log(
          "Completa la configuración para probar una ruta. No se llamó a Google.",
        );
        process.exitCode = 2;
      } else if (!result.route_tested) {
        console.log(
          "Configuración presente. Añade --destination para medir una ruta real. No se llamó a Google.",
        );
      } else {
        console.log(
          `Ruta medida: ${result.distance_miles.toFixed(2)} millas por carretera (${result.distance_meters} metros).`,
        );
        console.log(
          result.fee_cents === null
            ? "Fuera de las bandas automáticas: cotización personalizada o pickup."
            : `Tarifa según las bandas guardadas: $${(result.fee_cents / 100).toFixed(2)}.`,
        );
        console.log(
          "No se guardaron pedidos ni se modificó la configuración de delivery.",
        );
      }
    }
  } catch (error) {
    console.error(
      error.code?.startsWith("DELIVERY_")
        ? `No se pudo completar la comprobación (${error.code}). Revisa la API, la clave, sus restricciones y la facturación en Google Cloud.`
        : "No se pudo comprobar delivery. Revisa la conexión del backend y que sus migraciones estén instaladas.",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
