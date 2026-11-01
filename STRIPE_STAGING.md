# Compra de prueba con Stripe en Render

Entorno: `https://sweet-by-andre-staging.onrender.com`.
Este procedimiento usa exclusivamente la cuenta y las claves de prueba de
Stripe. No necesita una tarjeta real y no activa pagos de producción.

## Configuración del servicio

El Dockerfile utiliza `ENABLE_STRIPE_CHECKOUT` como argumento de compilación
para el frontend y como variable de ejecución para el backend. Render transmite
las variables del servicio como argumentos de Docker cuando están declarados.
El valor predeterminado sigue siendo `false`.

La activación se gestiona en **Environment** del servicio. El Blueprint ya no
fuerza esa variable a `false` en cada sincronización; los servicios nuevos siguen
desactivados por el valor predeterminado del Dockerfile.

Antes de activar pruebas, configura estas tres variables en Render:

| Variable | Valor |
| --- | --- |
| `ENABLE_STRIPE_CHECKOUT` | `true` |
| `STRIPE_SECRET_KEY` | La clave `sk_test_...` de la cuenta de pruebas |
| `STRIPE_WEBHOOK_SECRET` | El secreto `whsec_...` del endpoint público de staging |

El secreto del listener local de Stripe CLI es distinto al del endpoint de
Render. No copies la configuración de base de datos de `backend/.env` a Render.
Si se preparó `backend/.env.stripe-staging`, importa únicamente ese archivo con
**Environment → Add from .env**. Está excluido de Git y del contexto Docker.

Sube primero los cambios de este repositorio a la rama conectada a Render y
después elige **Save, rebuild, and deploy** al guardar estas variables. Un simple
reinicio no recompila el botón del frontend. No cambies `APP_ENV=staging` ni
las variables que mantienen email/SMS desactivados durante estas pruebas.
El arranque rechaza una clave real y rechaza activar pagos sin secreto de webhook.

## Endpoint público

```text
https://sweet-by-andre-staging.onrender.com/api/payments/webhook
```

En Stripe debe estar registrado en el mismo entorno de pruebas que la clave,
con eventos **snapshot** para:

- `checkout.session.completed`
- `checkout.session.expired`

El handler verifica la firma sobre el cuerpo original. El retorno del navegador
y el panel de administración no marcan pedidos como pagados.

## Prueba de compra

1. Abre staging, añade un postre y elige pickup con al menos 48 horas de anticipación.
2. Guarda el pedido y conserva su número.
3. Pulsa **Proceed to secure payment**.
4. En Stripe utiliza la tarjeta de pruebas `4242 4242 4242 4242`, una fecha
   futura como `12/34` y CVC `123`. No introduzcas una tarjeta real.
5. Al regresar, la página consulta automáticamente al backend durante unos
   30 segundos. Debe mostrar **Payment confirmed** cuando el webhook lo confirme.
6. Si la confirmación tarda más, pulsa **Check payment again**. No vuelvas a
   pagar para actualizar el estado.
7. En `/#admin/orders`, verifica el mismo pedido como pagado y avanza por
   **Accept order → Start preparing → Mark as ready → Mark as completed**.
   El pago confirmado y la aceptación de Andrea son pasos independientes.
8. Prueba cancelar otro Checkout: el pedido debe seguir pendiente y permitir
   volver al pedido para continuar; no debe quedar pagado por regresar a la web.

La página deja de consultar al verificar pago, al detectar un estado terminal,
al agotar los intentos o al salir. Un error de conexión permite reintentar.

## Diagnóstico

- `/api/health` debe devolver `{"status":"OK"}`.
- Un POST sin firma a `/api/payments/webhook` debe ser rechazado con `400`.
  Esa respuesta prueba que la ruta existe, no que el secreto esté bien configurado.
- Si no aparece el botón de pago, comprueba que la publicación se recompiló con
  `ENABLE_STRIPE_CHECKOUT=true` y que usa el Dockerfile actualizado.
- Si Stripe registra `400`, verifica el secreto de ese endpoint público.
- Si registra `500`, revisa los logs y que el evento corresponda a un pedido de
  esa base de staging. Un pago de otra base local no pertenece a staging.
- No uses eventos ficticios de `stripe trigger` para afirmar que se pagó un
  pedido real de la aplicación: debe coincidir el pedido, la sesión y el importe.

Para volver al modo sin pagos, establece `ENABLE_STRIPE_CHECKOUT=false` y
recompila. Las órdenes anteriores permanecen guardadas.

Referencias: [webhooks de Stripe](https://docs.stripe.com/webhooks),
[tarjetas de pruebas](https://docs.stripe.com/testing),
[variables y reconstrucción en Render](https://render.com/docs/configure-environment-variables)
y [argumentos Docker en Render](https://render.com/docs/docker#environment-variable-translation).
