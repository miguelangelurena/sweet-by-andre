# Prueba de Sweet by Andre en Render

El archivo `render.yaml` crea una aplicación Docker y una base PostgreSQL 18
independiente, ambas en Virginia y con plan Free. Express sirve el frontend y
la API desde la misma URL HTTPS. No necesitas publicar Vite por separado.

## 1. Subir la configuración a GitHub

Publica los cambios de este repositorio en la rama que vas a conectar a Render.
Actualmente trabajamos en `feat/frontend-setup-clean`. La rama elegida debe
contener `render.yaml`, `Dockerfile` y la configuración actual del backend.
No subas archivos `.env` ni contraseñas.

## 2. Crear el Blueprint

1. Entra a [Render Dashboard](https://dashboard.render.com/) con tu cuenta.
2. Selecciona **New → Blueprint** y conecta GitHub si te lo solicita.
3. Elige el repositorio `miguelangelurena/sweet-by-andre`.
4. Nombre del Blueprint: `sweet-by-andre-staging`.
5. Rama: `feat/frontend-setup-clean`, o la rama donde publicaste los cambios.
6. Blueprint Path: `render.yaml`.

Render leerá la configuración y mostrará dos recursos: `sweet-by-andre-staging`
y `sweet-by-andre-staging-db`. Ambos deben aparecer con plan **Free**. Si ya
tienes otra base gratuita, Render solo permite una por workspace; resuelve ese
límite antes de crear los recursos.

## 3. Completar los dos secretos

Render pedirá estas variables durante la creación:

| Variable | Qué introducir |
| --- | --- |
| `CSRF_SECRET` | Un secreto nuevo de 64 caracteres hexadecimales |
| `STAGING_ADMIN_PASSWORD` | Una contraseña exclusiva de al menos 16 caracteres para Andrea |

Para generar `CSRF_SECRET`, ejecuta en tu terminal local:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copia el resultado directamente al campo de Render. Guarda la contraseña en
tu gestor de contraseñas y compártela con Andrea por un canal privado.
El correo ya configurado es `sweetbyandre@gmail.com`.

`SESSION_SECRET` se genera automáticamente. `DATABASE_URL` se conecta a la
base de Render mediante su URL interna. No copies `backend/.env` ni
`frontend/.env.local` al formulario. La URL pública se detecta automáticamente
con `RENDER_EXTERNAL_URL`; no necesitas configurar `FRONTEND_URL` para el
dominio de Render.

## 4. Publicar y probar

Pulsa **Deploy Blueprint**. Render compilará React, instalará el backend e
inicializará la base antes de arrancar el servidor. No necesitas ejecutar SQL
manualmente. En los logs de la aplicación deberían aparecer:

```text
Staging database ready. Catalog and administrator configured; existing staging edits preserved.
Server listening on port: ...
```

El **Docker Command** debe ser `node scripts/startStaging.js`. Este script
inicializa la base y solo arranca el servidor si la inicialización termina bien.
Si tu servicio conserva el comando anterior con `sh -c`, sincroniza el Blueprint
después de subir los cambios. También puedes actualizar **Settings → Docker
Command** al valor indicado y volver a publicar.

Cuando el servicio esté disponible, abre su URL `https://<nombre>.onrender.com`.
Comprueba:

1. `/api/health` devuelve `{"status":"OK"}`.
2. `/#admin/login` permite iniciar sesión con el correo de Andrea y la contraseña elegida.
3. Puedes editar un producto, bloquear una fecha de preparación y guardar cambios.
4. Después de volver a publicar, esos cambios siguen guardados.

El enlace para Andrea será `https://<nombre>.onrender.com/#admin/login`, usando
el dominio real que Render muestre en el servicio web.

## Alcance de esta prueba

El catálogo inicial se copia una sola vez. Los cambios posteriores de Andrea
se guardan en PostgreSQL y no se borran al publicar otra versión. No se copian
usuarios, pedidos ni direcciones privadas de tu base local. Cambiar la variable
`STAGING_ADMIN_PASSWORD` después del primer arranque no cambia la contraseña
de una cuenta que ya existe.

Los pagos y las notificaciones están desactivados. Para probar cargas de fotos,
añade `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET` en
**Environment** del servicio web. Se usa la carpeta de pruebas de Cloudinary.
Para habilitar cotizaciones de delivery también hacen falta la dirección de
salida y `GOOGLE_ROUTES_API_KEY`; pickup puede probarse mientras tanto.

Con el plan Free, la aplicación se suspende tras 15 minutos sin tráfico y puede
tardar aproximadamente un minuto en despertar. La base gratuita caduca a los
30 días, no incluye backups y se elimina después del período de gracia si no
se actualiza su plan. Antes de esa fecha, exporta los datos que quieras conservar
o cambia a una base de pago. Si cambias planes, actualiza también `render.yaml`
para que una sincronización posterior no revierta tu configuración.

Esta preparación no crea recursos ni publica nada en tu cuenta de Render.
La compilación de la imagen Docker se verifica durante el primer despliegue.

Referencias oficiales: [Blueprints](https://render.com/docs/infrastructure-as-code),
[configuración YAML](https://render.com/docs/blueprint-spec),
[variables automáticas](https://render.com/docs/environment-variables) y
[límites del plan gratuito](https://render.com/docs/free).
