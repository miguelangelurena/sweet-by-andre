# Respaldos y recuperación

Los comandos de respaldo y verificación están implementados y probados con PostgreSQL local y datos ficticios. Todavía no hay copias externas programadas, retención automática ni alertas configuradas para el hosting.

## Qué se guarda

`db:backup` utiliza `pg_dump` en formato custom. Guarda el esquema y los datos de una base completa sin propietarios ni permisos del servidor original. No incluye las imágenes alojadas en Cloudinary, los secretos de Render, archivos `.env`, roles globales de PostgreSQL ni la configuración de Stripe, Brevo o Cloudflare.

El manifiesto registra fecha UTC, versión del servidor, tamaño, SHA-256 del archivo y recuentos y huellas de las tablas de `public`. El inventario de datos y el archivo usan la misma instantánea de PostgreSQL, aunque haya escrituras concurrentes. La comparación automatizada de filas cubre `public`; el archivo contiene también otros esquemas de usuario si existen.

La implementación sigue las herramientas oficiales [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html) y [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html). Un respaldo lógico es complementario a la recuperación del proveedor; no sustituye una estrategia de recuperación continua.

## Crear una copia manual

Requisitos: herramientas de PostgreSQL compatibles con el servidor, espacio disponible y permiso para leer todas las tablas. En Windows se detecta PostgreSQL 18 en su ruta habitual; usa `PG_BIN` si está instalado en otra ubicación. En otros sistemas se buscan las herramientas en `PATH`.

Desde `backend`, con la conexión de la base que quieres respaldar configurada en tu entorno:

```powershell
npm.cmd run db:backup
```

`DATABASE_URL` tiene prioridad sobre `DB_*`, igual que en la aplicación. No pases contraseñas en los argumentos del comando ni las pegues en el chat. El script transmite la conexión al proceso hijo mediante variables y no imprime credenciales ni errores SQL con datos de clientes. Si usas certificados privados, configura también las rutas de certificados que necesite libpq, como `PGSSLROOTCERT`.

Por defecto se crea una carpeta única dentro de `tmp/database-backups`, excluida de Git y Docker. `BACKUP_DIR` permite escoger una ubicación privada distinta. Cada carpeta completa contiene:

- `database.dump`: archivo comprimido, **sin cifrado**.
- `manifest.json`: inventario e integridad del respaldo.

No se sobrescriben copias anteriores. Una carpeta sin manifiesto completo o con `.partial` no es una copia válida. Los scripts no borran automáticamente respaldos antiguos o incompletos.

El repositorio está dentro de OneDrive: excluir un archivo de Git no evita su sincronización. Para datos reales, usa un destino privado fuera del repositorio, con acceso restringido y cifrado; guarda una copia externa cifrada. Los respaldos incluyen direcciones, sesiones y colas de notificaciones. No los adjuntes a incidencias ni los sirvas desde el sitio web.

## Comprobar que se puede restaurar

Configura una conexión **local** de PostgreSQL con permiso `CREATE DATABASE`. Si la conexión actual apunta al hosting, cámbiala solo para la terminal de verificación antes de ejecutar el comando. El archivo conserva los datos de origen; no necesita volver a conectarse a esa base.

```powershell
npm.cmd run db:backup:verify -- "ruta-a-la-carpeta-del-respaldo"
```

El comando acepta únicamente un archivo propio y confiable. Un dump de PostgreSQL puede ejecutar código al restaurarse: SHA-256 detecta cambios accidentales, pero no certifica quién creó el archivo.

La verificación:

1. Comprueba tamaño y SHA-256 antes de restaurar.
2. Rechaza servidores que no sean `localhost`, `127.0.0.1` o `::1`.
3. Crea una base con nombre aleatorio `sweet_by_andre_restore_…`. No acepta el nombre de una base de destino existente.
4. Restaura en una sola transacción y compara tablas, recuentos y huellas de datos.
5. Elimina únicamente la base temporal que acaba de crear, incluso si detecta diferencias.

No arranca la aplicación ni envía correos o solicitudes a Stripe. El comando no implementa una restauración sobre producción.

Para repetir la prueba con datos ficticios, sin exportar la base de desarrollo:

```powershell
npm.cmd run test:backup
```

La prueba crea y elimina sus propias bases locales. Comprueba recuperación, conservación del origen, diferencias de datos, archivo alterado y rechazo de destinos remotos.

## Operación en producción: pendiente de configurar

La configuración versionada de Render usa Free. No se ha verificado el plan actual de la cuenta. Render documenta [recuperación y respaldos para bases de pago](https://render.com/docs/postgresql-backups) y las [limitaciones de Free](https://render.com/docs/free). Antes de usar datos reales, configura y prueba la recuperación del proveedor y una copia externa independiente.

Propuesta inicial para acordar con la dueña:

- Recuperación continua del proveedor y un respaldo lógico externo diario.
- Retención de 14 copias diarias y 4 semanales, sujetas al volumen y las necesidades del negocio.
- Una copia adicional antes de cada migración de datos o cambio de despliegue importante.
- Verificación mensual de restauración y tras cambios del esquema.
- Alerta al responsable si falla una copia o la última copia correcta tiene más de 26 horas.

Una copia diaria puede perder hasta un día de cambios. La dueña debe aceptar el objetivo de pérdida máxima de datos y tiempo de recuperación; no se ha establecido un SLA ni comprobado el tiempo de recuperación del hosting. La ejecución requiere un job o servicio independiente con herramientas PostgreSQL y almacenamiento externo. El Dockerfile de la aplicación no incluye estas herramientas y los archivos del contenedor no son un almacén de respaldos.

## Procedimiento ante una incidencia

1. Detener nuevas escrituras y desactivar checkout, reembolsos y envíos de correo mientras se investiga. Conservar logs y el estado actual.
2. Elegir una copia o punto de recuperación y restaurar en una **base nueva y aislada**, usando la recuperación del proveedor o un procedimiento manual revisado. Conservar la base original.
3. Verificar pedidos, importes, inventario, reservas, usuarios y migraciones. Una comparación de recuentos no sustituye la revisión del negocio.
4. Reconciliar pagos y reembolsos con Stripe: restaurar una base no revierte movimientos de dinero. Revisar webhooks posteriores a la fecha de la copia sin crear cobros nuevos.
5. Revisar sesiones, intentos de checkout, bloqueos temporales y correos pendientes. Mantener el worker apagado hasta evitar reenvíos; establecer un corte temporal adecuado y reconciliar los resultados inciertos con Brevo.
6. Probar cookies, login y pedidos con integraciones controladas. Cambiar la conexión solo cuando la nueva base esté validada y haya una vía de reversión.
7. Reabrir las funciones gradualmente, observar errores y dejar registro del punto restaurado y de las operaciones reconciliadas.

La copia debe acompañarse de acceso seguro a las cuentas y secretos necesarios. Guarda ese acceso en un gestor de contraseñas del negocio, separado del respaldo.
