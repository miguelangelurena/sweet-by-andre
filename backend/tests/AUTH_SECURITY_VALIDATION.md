# Protección del acceso administrativo

## Instalación

En desarrollo local, desde `backend`, ejecuta `npm.cmd run db:auth` antes de arrancar el backend actualizado. El instalador solo acepta las bases locales `sweet_by_andre_dev` y `sweet_by_andre_test`.

Staging aplica `auth-security.sql` automáticamente al arrancar con `startStaging.js`. Publica backend y frontend juntos: el catálogo administrativo ahora exige CSRF y necesita el frontend actualizado. La migración agrega una tabla de contadores; conserva usuarios, pedidos y sesiones.

Si la tabla o PostgreSQL no están disponibles, login y registro responden 503. No se omite la protección. El diseño del despliegue de producción deberá aplicar esta migración antes de servir tráfico.

## Comportamiento

- Login: hasta 30 solicitudes por IP y hasta 10 por combinación de IP y correo en ventanas de 15 minutos.
- Registro: hasta 10 por IP y hasta 5 por combinación de IP y correo en la misma ventana.
- Los contadores incluyen intentos correctos e incorrectos. Una IP compartida también comparte su límite.
- Al superar un límite, la API devuelve 429 y `Retry-After` en segundos. Esperar hasta el vencimiento permite volver a intentar.
- PostgreSQL actualiza los contadores de forma atómica, incluso con varias instancias. Reiniciar el backend no los borra. Se eliminan contadores vencidos en lotes durante las solicitudes posteriores.
- Las claves almacenadas usan HMAC con `SESSION_SECRET`; no guardan IP ni correo en texto. Rotar ese secreto cambia las claves de los contadores y también invalida sesiones.
- La IP procede de Express. La configuración actual de hosting confía en un salto de proxy en producción; hay que verificar esta configuración si cambia la cadena de proxies.
- El registro sigue creando clientes, aunque la solicitud incluya `role: admin`. Exige al menos 12 caracteres y un máximo de 72 bytes UTF-8 para contraseñas nuevas. El login mantiene contraseñas existentes de menor longitud, dentro del límite de bcrypt.
- Cada solicitud protegida consulta el rol actual y excluye usuarios desactivados. El login regenera la sesión y las respuestas de autenticación llevan `Cache-Control: no-store`.
- Las modificaciones de productos, opciones, variantes e imágenes requieren sesión, rol administrador y token CSRF. El upload valida esos requisitos antes de procesar el archivo.

Estos límites reducen intentos repetidos; no sustituyen protección de infraestructura frente a tráfico masivo o ataques distribuidos. Sigue pendiente la revisión de producción completa, incluida la configuración del proxy, recuperación de cuentas y monitoreo.

## Pruebas automatizadas

Ejecuta `npm.cmd run test:checkout`. El ejecutor instala el esquema y limpia únicamente los contadores temporales de la base de pruebas antes de ejecutar la suite.

`auth-security.test.js` comprueba concurrencia, persistencia entre instancias del middleware, normalización del correo, aislamiento por IP, rotación de correos, recuperación tras vencer la ventana y rechazo si falla el almacenamiento. También verifica tipos de entrada, límite de bytes, imposibilidad de elegir rol al registrarse, rotación de sesiones, revocación del rol, desactivación y CSRF en las 13 rutas de escritura del catálogo. Comprueba ediciones legítimas de disponibilidad y precio con token válido.

`npm.cmd run test:staging` comprueba instalación desde cero, cookies HTTPS y conservación de datos al repetir la inicialización.

## Comprobación manual antes de publicar

1. Entrar al panel y cambiar filtros; abrir y cerrar varios pedidos sin que se mezclen sus detalles.
2. Abrir categorías y probar una edición reversible.
3. Modificar y restaurar un precio o disponibilidad en un producto de prueba.
4. Elegir una foto, cambiarla y quitarla; comprobar el preview y subir una imagen de prueba.
5. Probar los selectores con ratón, teclado y una pantalla pequeña.

La compilación y el lint no sustituyen estas comprobaciones visuales.

La recuperación asistida y el cambio de contraseña invalidan las sesiones de la cuenta, incluido un registro antiguo que vuelva a guardarse por una solicitud concurrente. Las sesiones previas a esta actualización deben iniciar sesión otra vez. No se necesita migración de esquema. Consulta [ADMIN_ACCESS_RECOVERY.md](../../ADMIN_ACCESS_RECOVERY.md) para el procedimiento y sus pruebas.
