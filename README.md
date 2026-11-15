# Sweet by André

Tienda de postres con catálogo, carrito de invitados, pedidos para pickup o delivery y panel administrativo.

El entorno publicado es staging: https://sweet-by-andre-staging.onrender.com. Las pruebas de Stripe usan sandbox. La configuración de despliegue actual todavía no constituye una instalación de producción.

## Funciones implementadas

- Productos, categorías, imágenes y variantes con precios y disponibilidad.
- Pedidos con pago completo y al menos 48 horas de anticipación.
- Inventario físico y productos bajo pedido con capacidad de preparación por fecha.
- Checkout de Stripe; el backend confirma el pago tras validar el webhook.
- Gestión administrativa: aceptación, preparación, pedido listo y completado.
- Rechazo y reembolso completo en sandbox, con protección ante eventos repetidos.
- Cola de correos transaccionales y adaptador de Brevo. El envío requiere activación y configuración explícitas; falta validar la entrega externa.

## Tecnología

Frontend React y Vite con Tailwind CSS. Backend Node.js y Express, PostgreSQL y sesiones de servidor. Stripe para pagos, Cloudinary para imágenes y Brevo para correos. El staging usa Docker en Render.

## Desarrollo local

Requisitos: Node.js 24, npm y PostgreSQL. Estos comandos usan PowerShell en Windows.

1. Ejecuta `npm.cmd ci` dentro de `backend` y de `frontend`.
2. Copia `backend/.env.example` a `backend/.env` y configura la conexión local, los secretos de sesión y las integraciones necesarias. No publiques ese archivo.
3. Usa una base de desarrollo con el esquema de la aplicación. `backend/database/bootstrap.sql` contiene el esquema de referencia. En una instalación local existente, ejecuta `npm.cmd run db:auth` desde `backend` antes de probar el login actualizado. Revisa las guías antes de aplicar migraciones sobre datos existentes.
4. Arranca ambos procesos en terminales separadas:

```powershell
# Terminal 1, desde backend
npm.cmd run dev

# Terminal 2, desde frontend
npm.cmd run dev
```

Abre `http://localhost:5173`. Vite envía `/api` al backend en el puerto 5000. Un error `ECONNREFUSED` del proxy indica que no puede conectar con el backend; revisa que esté arrancado y escuchando en ese puerto.

Para probar Stripe localmente, sigue la guía de checkout y mantén el listener de webhooks activo en otra terminal. El frontend necesita `VITE_ENABLE_STRIPE_CHECKOUT=true` en `frontend/.env.local` y el backend su propia activación con credenciales de prueba.

## Validación

Desde `frontend`:

```powershell
npm.cmd run lint
npm.cmd run build
```

Desde `backend`:

```powershell
npm.cmd run test:checkout
npm.cmd run test:staging
npm.cmd run notifications:status
```

La suite de checkout requiere una base separada llamada `sweet_by_andre_test` con el esquema base. El ejecutor configura esa base y evita utilizar la de desarrollo. Las pruebas automatizadas no realizan cobros ni envían correos reales.

## Guías

- [Despliegue en Render](RENDER.md).
- [Pruebas de Stripe en staging](STRIPE_STAGING.md).
- [Validación de checkout](backend/tests/CHECKOUT_VALIDATION.md).
- [Rechazos y reembolsos](backend/tests/REFUND_VALIDATION.md).
- [Activación y validación de correos](backend/tests/NOTIFICATIONS_VALIDATION.md).
- [Protección del acceso administrativo](backend/tests/AUTH_SECURITY_VALIDATION.md).
- [Respaldos y recuperación](BACKUPS.md).
- [Preparación para producción y entrega](PRODUCTION_READINESS.md).
- [Configuración y arranque de producción](PRODUCTION_SETUP.md).
- [Guía de uso para Andrea](GUIA_ANDREA.md).
- [Recuperación asistida del acceso administrativo](ADMIN_ACCESS_RECOVERY.md).
- [Configuración de delivery](DELIVERY_SETUP.md).
- [Capacidad de preparación](backend/database/PRODUCTION.md). Aquí `db:production` instala la capacidad de preparación; no despliega el sitio a producción.

## Pendientes para la entrega

- Completar Brevo, autenticar `sweetsbyandre.com` y verificar correos con destinatarios controlados.
- Completar la revisión de seguridad y comprobar los cambios del panel en navegador.
- Preparar el entorno de producción separado, con respaldos, restauración comprobada y monitoreo.
- Confirmar con la dueña impuestos, políticas comerciales, datos de contacto y requisitos para operar. Actualmente el cálculo de impuestos del pedido es cero.
- Preparar y validar la configuración de pagos reales. Los reembolsos administrativos actuales están limitados a claves de prueba.
- Conectar el dominio final y realizar la aceptación completa antes del traspaso.

La configuración e inicialización de producción están preparadas para trabajar sin pagos ni envíos externos. Activar cobros reales requiere una fase posterior de validación; sustituir la clave de Stripe no habilita esa fase.
