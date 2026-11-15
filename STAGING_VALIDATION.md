# Validación publicada de staging

Fecha: 15 de noviembre de 2026. Entorno:
`https://sweet-by-andre-staging.onrender.com`.

Las ramas `security/application-hardening` y `feat/frontend-setup-clean` se
sincronizaron con los cambios de seguridad y SEO. La segunda es la rama indicada
en la guía de despliegue de Render. Se comprobó la versión publicada por sus
cabeceras, HTML, recursos optimizados y comportamiento; no solo por el estado
«Live» del proveedor. No se modificaron producción, DNS ni Docker local.

## Comprobaciones aprobadas

- Backend saludable: respuesta mínima `{"status":"OK"}`.
- Cabeceras CSP, HSTS, nosniff, DENY y no-referrer publicadas; API sin caché.
- HTML inicial, metadatos, enlaces públicos, precios y datos estructurados.
- Staging permanece `noindex`; `robots.txt` bloquea rastreo y no publica sitemap.
- Rutas inexistentes devuelven 404 real y páginas de retorno de pago no indexables.
- API administrativa rechaza acceso anónimo. Sesión administrativa real accede
  a productos, pedidos, capacidad y delivery. Logout sin CSRF se rechaza.
- El botón Sign out cierra la sesión y vuelve al login; `/api/auth/me` y
  productos administrativos responden 401 después del cierre.
- Chrome: catálogo móvil sin desbordamiento, enlaces antiguos migrados, precio
  del producto coherente con API, acceso administrativo y metadatos privados.
- Creación de un pedido ficticio sandbox e idempotencia: repetir la misma
  solicitud devuelve el mismo pedido. Sesión `cs_test_` verificada antes de abrir Stripe.
- Pago sandbox de $2.49: el backend confirmó `paid / pending`, visible también
  en administración, con reserva de preparación confirmada.
- Rechazo de ese mismo pedido: `refunded / cancelled`, reembolso `succeeded` y
  capacidad usada de la fecha de prueba de vuelta a cero. Repetir el rechazo
  conserva el resultado. Las reservas originales se retienen como historial;
  las canceladas no consumen capacidad efectiva.

Pedido de prueba: `59a02c6a-ad20-41bb-80a9-eb2982dc2f6d`. Figura identificado
como QA, con datos ficticios, y quedó reembolsado. El pago fue confirmado por el
flujo de webhook; el reembolso se verificó mediante el estado del backend y la
respuesta autenticada de Stripe. No se inspeccionaron manualmente los logs de
entrega del webhook de reembolso en el Dashboard de Stripe.

El usuario confirmó en Render que `ENABLE_TRANSACTIONAL_NOTIFICATIONS` y
`ENABLE_TRANSACTIONAL_SMS` permanecen en `false`. No se activaron envíos.
Al probar Brevo, establecer un `NOTIFICATIONS_START_AT` posterior a este ensayo
y la lista de destinatarios permitidos de staging. Así no se envían avisos
históricos de este pedido ficticio cuando se active el worker.

## Hallazgo: falta configurar almacenamiento de imágenes

La carga de una imagen JPEG válida desde una sesión administrativa devolvió 500.
El usuario confirmó que Render no tiene `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY` ni `CLOUDINARY_API_SECRET`. Las fotos existentes se muestran
desde URLs ya guardadas; eso no habilita nuevas cargas autenticadas.

No se insertó una imagen nueva en el producto y se conserva su fotografía
original. Se publicó y verificó una corrección que responde 503 con el código
`IMAGE_HOSTING_NOT_CONFIGURED` y una indicación de contactar soporte, sin mostrar
claves. La ausencia de credenciales se comprueba antes de contactar al proveedor.
Las pruebas verifican tanto esa protección como la respuesta HTTP.

Para completar la carga y eliminación hay que configurar una cuenta autorizada
de Cloudinary en Render, con carpeta `sweet-by-andre/staging`. Las credenciales
son exclusivas del backend; no se comparten en el chat ni se agregan a variables
`VITE_*`. La configuración de este proveedor es independiente de Brevo.

## Pruebas todavía pendientes de cerrar

- Carga y eliminación de una fotografía después de configurar Cloudinary.
- Correos y SMS: siguen desactivados y no se consideran validados.

Las evidencias técnicas públicas y de navegador se guardan en
`tmp/staging-validation/`, ignorado por Git. No incluyen contraseñas ni claves.

Las 136 pruebas automatizadas del backend aprobaron, incluidas las nuevas
comprobaciones de configuración ausente de imágenes. También aprobaron las
pruebas locales de hosting y la compilación/lint de la versión SEO publicada.
