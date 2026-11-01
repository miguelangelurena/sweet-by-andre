# Entorno de pruebas para Sweet by Andre

Para publicar en Render, sigue [la guía de Render](RENDER.md). El archivo
`render.yaml` configura la aplicación y PostgreSQL juntos. La alternativa
Railway se conserva documentada a continuación.

Este despliegue sirve React y Express desde una sola dirección HTTPS, con
PostgreSQL independiente. El panel de Andrea será `https://<dominio>/#admin/login`.
La configuración usa un contenedor Node 24 y `railway.json` desde la raíz del
repositorio. No se necesita cambiar el dominio público actual de la marca.

## Preparado en el repositorio

- `Dockerfile`: compila el frontend y ejecuta el backend sin servidor Vite.
- `.dockerignore`: excluye `.env`, cookies locales, Git y dependencias locales.
- `backend/database/bootstrap.sql`: esquema completo, sin datos ni usuarios.
- `backend/database/demo-catalog.json`: copia inicial de productos, opciones,
  variantes, fotos públicas y colecciones. No contiene clientes ni pedidos.
- `backend/scripts/initializeStaging.js`: inicializa una base vacía, crea el
  usuario administrador y aplica las migraciones de delivery y preparación.

El catálogo se importa solo una vez. Las publicaciones posteriores conservan
los cambios que Andrea haga en el panel. No se sincroniza automáticamente con
la base de desarrollo ni con una futura base de producción.

## Configuración en Railway

1. Crear un proyecto o entorno persistente llamado `staging` y añadir un
   PostgreSQL independiente. Usar PostgreSQL 18 para coincidir con el esquema
   exportado y la validación local.
2. Crear el servicio de la aplicación desde una rama de pruebas de este
   repositorio, con directorio raíz `/`. Railway detecta `Dockerfile` y
   `railway.json`. Configurar las publicaciones automáticas desde esa rama.
3. En las variables del servicio de la aplicación, configurar:

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | Referencia privada `${{Postgres.DATABASE_URL}}`, ajustando el nombre del servicio |
| `APP_ENV` | `staging` |
| `NODE_ENV` | `production` |
| `SERVE_FRONTEND` | `true` |
| `SESSION_SECRET` | Secreto aleatorio propio de este entorno |
| `CSRF_SECRET` | 64 caracteres hexadecimales aleatorios |
| `STAGING_ADMIN_EMAIL` | `sweetbyandre@gmail.com` |
| `STAGING_ADMIN_PASSWORD` | Contraseña exclusiva, de al menos 16 caracteres |
| `ENABLE_STRIPE_CHECKOUT` | `false` |
| `ENABLE_TRANSACTIONAL_NOTIFICATIONS` | `false` |
| `ENABLE_TRANSACTIONAL_SMS` | `false` |

No copiar todas las variables de `backend/.env`: podría conectar el entorno
a la base o servicios locales. Configurar contraseñas directamente como
variables del servicio; no se guardan en Git ni se imprimen en los scripts.

4. Generar un dominio HTTPS para el servicio. `RAILWAY_PUBLIC_DOMAIN` permite
   que el backend reconozca su propio origen. Si se usa un dominio personalizado,
   establecer `FRONTEND_URL=https://<dominio>` sin ruta, query ni fragmento.
5. Publicar. Railway ejecuta `initializeStaging.js` antes del arranque y comprueba
   `/api/health`. El primer arranque exige una base vacía y las credenciales del
   administrador. Los siguientes arranques no reemplazan su cuenta ni catálogo.
6. Probar el login, editar un producto y una fecha de preparación, volver a
   publicar y comprobar que las modificaciones siguen guardadas.

Railway factura según el plan y los recursos utilizados. Esta preparación no
crea cuentas, suscripciones ni cargos.

Referencias: [entornos aislados](https://docs.railway.com/environments),
[PostgreSQL](https://docs.railway.com/databases/postgresql),
[Dockerfiles](https://docs.railway.com/builds/dockerfiles) y
[configuración del despliegue](https://docs.railway.com/config-as-code/reference).

## Alcance inicial de las pruebas

Andrea puede revisar productos, precios, variantes, disponibilidad, capacidad
de preparación, fechas bloqueadas y configuración del delivery. La página
muestra una franja de entorno de pruebas y envía `X-Robots-Tag: noindex, nofollow`.
El panel sigue protegido por login y rol de administrador. La franja y la
instrucción a buscadores no sustituyen el control de acceso.

Los pagos están desactivados en el frontend y backend. Se puede probar la
creación de pedidos pendientes, pero no se necesita configurar Stripe para
explorar el panel. El backend rechaza claves de Stripe reales en staging.
Si posteriormente se habilita una compra de prueba, será necesario configurar
una clave de test, su webhook público y recompilar el frontend con ese objetivo.

Para probar cargas de fotos, configurar las credenciales de Cloudinary en
Railway. Las cargas van a `sweet-by-andre/staging/...`. Las fotos iniciales usan
URLs de lectura, sin IDs de borrado de los archivos originales: borrar su
registro de prueba no elimina la imagen original en Cloudinary. El backend de
staging rechaza el borrado de archivos fuera de su carpeta de pruebas.

El modo de tarifas fijas por ZIP no requiere Google ni tarjeta. Las tarifas se
configuran y activan desde administración; ver [DELIVERY_SETUP.md](DELIVERY_SETUP.md).
El cálculo alternativo de millas requiere `GOOGLE_ROUTES_API_KEY` y activar delivery desde
administración. Si falta esa configuración, pickup sigue disponible. Ningún
script de esta preparación crea una cuenta de Google ni habilita facturación.

## Datos y publicaciones posteriores

No se copian usuarios, hashes de contraseñas, sesiones, carritos, pedidos,
pagos, direcciones privadas, reservas ni notificaciones de la base local. La
dirección de salida del delivery se puede introducir en el panel de pruebas.
La contraseña inicial no se restablece al volver a publicar; cambiar la variable
de arranque no cambia una cuenta que ya existe.

El esquema inicial se crea exclusivamente sobre una base vacía. Un marcador
identifica la base como staging y evita reutilizar una base existente por error.
Las migraciones de funciones nuevas deben añadirse a los scripts de despliegue;
actualizar solo `bootstrap.sql` no modifica instalaciones ya inicializadas.

Para arrancar fuera de Railway, usar las mismas variables y, desde `backend`,
ejecutar `npm run db:staging` y `npm start` después de compilar el frontend.

## Verificación local

Compilar primero con `npm.cmd run build` desde `frontend`. Después ejecutar
`npm.cmd run test:staging` desde `backend`, con la conexión PostgreSQL local
configurada. La prueba crea una base temporal propia, valida el arranque,
sesiones de administrador con cookies seguras y persistencia de cambios al
republicar, y elimina esa base al terminar. El usuario PostgreSQL local debe
tener permiso para crear bases. No usa la base local de la tienda como destino.

`npm.cmd run test:checkout` ejecuta además la regresión del flujo de negocio.
La imagen Docker requiere una compilación adicional en Docker o Railway;
las pruebas locales de Node no reemplazan esa comprobación.
