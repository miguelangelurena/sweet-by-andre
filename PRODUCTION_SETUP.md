# Preparación del despliegue de producción

El repositorio ya incluye una inicialización separada de staging. Esta fase permite preparar el catálogo y el panel con pagos, reembolsos, correos y SMS desactivados. El arranque rechaza su activación hasta implementar y validar la fase de lanzamiento correspondiente.

No se ha creado un servicio real ni una base de pago durante este trabajo. La URL de un servicio que se publique será pública: `noindex` evita solicitar indexación, pero no constituye un control de acceso.

## Configuración de la imagen

El Dockerfile admite `APP_ENV` como argumento de compilación y variable de ejecución. Su valor predeterminado sigue siendo `staging`; el Blueprint existente conserva ese entorno.

Para preparar la imagen de producción, desde la raíz:

```powershell
docker build --build-arg APP_ENV=production --build-arg ENABLE_STRIPE_CHECKOUT=false -t sweet-by-andre:production-prep .
```

Solo se usan como argumentos valores públicos del entorno. Las claves, contraseñas y conexiones se configuran al ejecutar el servicio; no se incorporan al frontend ni al historial de compilación. Consulta [las variables de Docker](https://docs.docker.com/build/building/variables/).

En Render, usa un **servicio separado** del staging con su propia base, el Dockerfile de este repositorio y el contexto raíz. Configura `APP_ENV=production` y `ENABLE_STRIPE_CHECKOUT=false` antes de compilar. Render transmite las variables del servicio como argumentos Docker cuando están declaradas en el Dockerfile. [Documentación de Render](https://render.com/docs/docker).

El comando del contenedor es `node scripts/startHosted.js`, que selecciona el inicializador por `APP_ENV`. Puedes dejar **Docker Command** sin sobrescribir o usar `node scripts/startProduction.js`. No reutilices `startStaging.js`. Configura `/api/health` como comprobación de salud.

Las imágenes completas de staging y producción ya se compilaron y probaron en Docker con PostgreSQL 18 desechable. La validación cubre inicialización desde cero, frontend, cookies seguras mediante el proxy simulado, CSRF, cierre de sesión y conservación de cambios y sesiones tras reiniciar. El primer arranque restaura la ruta de búsqueda de PostgreSQL antes de devolver la conexión de inicialización al pool de la API.

Para repetirla, con Docker Desktop activo, ejecuta `npm.cmd run test:docker` desde `backend`. Descarga las imágenes base necesarias, crea una red y contenedores temporales con credenciales generadas y elimina esos recursos al terminar. Solo publica los puertos HTTP de prueba en loopback; no publica PostgreSQL ni usa bases o cuentas del hosting. Las dos imágenes locales `sweet-by-andre:validation-staging` y `sweet-by-andre:validation-production` permanecen disponibles en la caché de Docker.

## Variables requeridas

Usa [backend/.env.production.example](backend/.env.production.example) como inventario. Es una plantilla sin credenciales; no es un archivo listo para importar sin completar. `dotenv` no carga automáticamente un archivo `.env.production`: en hosting configura estas variables directamente.

| Variable | Configuración |
| --- | --- |
| `APP_ENV`, `NODE_ENV` | `production` |
| `SERVE_FRONTEND` | `true` |
| `DATABASE_URL` | Conexión de la base nueva de producción |
| `PRODUCTION_DB_NAME` | Nombre exacto de esa base, no la URL |
| `FRONTEND_URL` | Un único origen HTTPS sin barra final; inicialmente puede ser la URL del servicio nuevo |
| `SESSION_SECRET` | Secreto exclusivo de al menos 32 caracteres |
| `CSRF_SECRET` | Secreto exclusivo de 64 caracteres hexadecimales |
| `ENABLE_STRIPE_CHECKOUT` | `false` explícito |
| `ENABLE_ADMIN_REFUNDS` | `false` explícito |
| `ENABLE_TRANSACTIONAL_NOTIFICATIONS` | `false` explícito |
| `ENABLE_TRANSACTIONAL_SMS` | `false` explícito |
| `SITE_INDEXABLE` | `false` durante la preparación |

Las claves de Stripe y Brevo pueden permanecer vacías en esta fase. Una clave test de Stripe se rechaza en producción; habilitar checkout también se rechaza, aunque se configure una clave live. La biblioteca Stripe usa una credencial interna inerte cuando no hay clave: no corresponde a una cuenta ni habilita pagos.

Para el primer arranque también hacen falta `PRODUCTION_ADMIN_EMAIL`, `PRODUCTION_ADMIN_PASSWORD`, `PRODUCTION_ADMIN_FIRST_NAME` y `PRODUCTION_ADMIN_LAST_NAME`. La contraseña debe tener al menos 16 caracteres y como máximo 72 bytes UTF-8. `PRODUCTION_ADMIN_PHONE` es opcional y puede quedar vacío.

No hay un correo de administración predeterminado: todavía debe confirmarse el correo correcto de la dueña. Guarda los accesos en el gestor de contraseñas del negocio y comparte solo por un canal privado.

## Primera inicialización

`startProduction.js` valida primero las variables y después la base. La base debe estar vacía, su nombre debe coincidir con `PRODUCTION_DB_NAME` y no puede tener un nombre identificado como desarrollo, test, staging o restauración.

El inicializador:

1. Crea el esquema y marca `deployment_metadata.environment=production`.
2. Crea un único administrador con los datos configurados.
3. Aplica y registra las cinco migraciones actuales con sus huellas SHA-256.
4. Mantiene catálogo, pedidos, pagos, carritos y colas vacíos.
5. Desactiva delivery y deja cerrados todos los días de preparación hasta que se configure la disponibilidad aprobada.

La configuración de delivery contiene valores iniciales que deben revisarse antes de habilitarlo. No hay catálogo demo, importación de la base local ni copia de pedidos sandbox.

## Publicaciones posteriores

El arranque conserva usuarios, contraseña, catálogo y configuración existentes. Cambiar `PRODUCTION_ADMIN_PASSWORD` en el hosting no cambia una contraseña guardada. Una base marcada como staging o una base no vacía sin identificar se rechaza; no se convierte ni se sobrescribe.

`deployment_migrations` guarda archivo, checksum y fecha. Cada archivo se ejecuta una sola vez. Si un archivo ya aplicado cambia, el despliegue se detiene. Las diferencias de fin de línea Windows/Linux se normalizan antes de calcular la huella.

Después del primer despliegue real, conserva los archivos aplicados sin cambios. Para evolucionar el esquema, agrega una migración nueva a la lista de `initializeProduction.js` y prepara validación y respaldo antes de publicarla. No borres registros de migración para forzar su repetición. Las migraciones de esta fase se ejecutan en una transacción bajo bloqueo de inicialización.

Desde `backend` están disponibles:

```powershell
# Solo esquema e inicialización, sin arrancar HTTP
npm.cmd run db:deploy-production

# Validación, inicialización y servidor
npm.cmd run start:production
```

`db:production` sigue refiriéndose a capacidad de preparación de postres, no a despliegue. Para este trabajo usa los comandos anteriores.

## Comprobación antes del primer despliegue real

```powershell
# Desde frontend
npm.cmd run lint
npm.cmd run build
npm.cmd run test:hosting

# Desde backend
npm.cmd run test:deployment
npm.cmd run test:staging
npm.cmd run test:checkout
```

La prueba de despliegue exige PostgreSQL local con permiso para crear bases. Crea y elimina una base aleatoria propia; no utiliza la base real de producción. Comprueba catálogo vacío, rechazo de bases incorrectas, rollback, migraciones, conservación de ediciones, login, cookies seguras, origen y CSRF. No contacta Stripe ni Brevo.

`test:hosting` compila a un directorio temporal: verifica que producción no tenga el banner de staging, que staging lo conserve y que falle una compilación de producción que intente activar pagos. `npm run build` sin configurar el entorno sigue siendo una compilación local; la imagen hospedada define los valores correspondientes mediante Docker.

La recuperación administrativa asistida y la validación Docker ya están preparadas. Antes de conectar datos reales todavía faltan los respaldos externos y alertas, el catálogo aprobado, las políticas e impuestos, el acuerdo de soporte y las fases de activación de pagos y correos. Sigue [ADMIN_ACCESS_RECOVERY.md](ADMIN_ACCESS_RECOVERY.md), [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) y [BACKUPS.md](BACKUPS.md).
