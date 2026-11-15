# Recuperación del acceso administrativo

Este procedimiento permite al responsable técnico restablecer la contraseña de un administrador existente. Funciona sin correo y sin Brevo. No crea cuentas, no convierte clientes en administradores y no reactiva usuarios desactivados.

Andrea solicita ayuda por el canal de soporte acordado. Antes de ejecutar el procedimiento, el responsable verifica su identidad y autorización mediante un canal conocido. Todavía no hay recuperación automática por correo desde la página de login.

## Preparación

Usa una terminal interactiva privada con acceso autorizado al entorno correspondiente. En hosting, la terminal debe recibir las variables del servicio y acceso a su base. En local, el comando usa la conexión configurada en `backend/.env`.

Comprueba `APP_ENV` y la conexión antes de continuar. `DATABASE_URL` tiene prioridad sobre `DB_*`.

Publica primero esta versión del backend en todas las instancias. La comprobación de la versión de credenciales debe estar activa en cada una antes de usar la recuperación.

- Desarrollo/test: solo bases locales `sweet_by_andre_dev` o `sweet_by_andre_test`.
- Staging: base marcada como staging, separada de las bases locales.
- Producción: base marcada como producción y nombre exacto en `PRODUCTION_DB_NAME`.

No necesitas activar pagos, correos ni reembolsos. Cambiar `STAGING_ADMIN_PASSWORD` o `PRODUCTION_ADMIN_PASSWORD` en el hosting no modifica una cuenta ya creada.

## Restablecer una contraseña

Desde `backend`:

```powershell
npm.cmd run admin:reset-password
```

El comando solicita:

1. Correo del administrador.
2. Contraseña nueva, introducida de forma oculta.
3. Repetición de la contraseña, también oculta.
4. Confirmación exacta `RESET <base> <ID del administrador>`.

Antes de confirmar, revisa el entorno, la base, el correo y el ID que muestra la terminal. La contraseña debe tener al menos 16 caracteres, como máximo 72 bytes UTF-8 y ser diferente de la anterior. Un carácter acentuado puede ocupar varios bytes.

El comando no acepta argumentos ni entrada redirigida. No pegues la contraseña en comandos, archivos `.env`, logs, incidencias o chats. Usa un gestor de contraseñas y el mecanismo privado acordado con Andrea para entregar o establecer la credencial nueva.

Si las contraseñas no coinciden o no escribes la confirmación exacta, no se cambia la cuenta. Una cuenta inexistente, cliente o desactivada se rechaza. Si otro operador cambia las credenciales después de la revisión, hay que iniciar el procedimiento de nuevo.

## Qué ocurre al confirmar

La actualización y la eliminación de los registros de sesión de esa cuenta ocurren en una transacción. Si falla uno de esos pasos, no se aplica ninguno. Las sesiones de otros usuarios se conservan.

Además, cada sesión autenticada queda vinculada a la versión actual de las credenciales. Una sesión anterior que vuelva a guardarse por una solicitud concurrente sigue sin autorizar nuevas solicitudes protegidas después del cambio. Esto no revierte una acción que ya estuviera autorizada y ejecutándose.

El resultado muestra cuántos registros de sesión se eliminaron. No imprime la contraseña ni su hash. No borra pedidos, pagos, productos, historial comercial ni bloqueos de login. La fecha `users.updated_at` se actualiza; el operador debe registrar el incidente y su resolución en el registro privado de soporte. No se envía una notificación automática de recuperación en esta fase.

## Comprobar el acceso

1. Andrea abre `/#admin/login` en el entorno correcto e inicia sesión con la nueva contraseña.
2. Comprueba que puede abrir **Products** y **Orders**.
3. Pulsa **Sign out** y verifica que una nueva entrada al panel solicite autenticación.
4. Si aparece un límite de intentos, espera el intervalo indicado. Restablecer la contraseña no elimina ese límite.

Si se sospecha acceso no autorizado, revisa también pedidos, reembolsos y logs. Este comando no recupera cuentas de Render, Stripe, Brevo, Cloudflare ni del gestor de contraseñas; esos accesos deben recuperarse con sus proveedores.

## Efecto de publicar esta actualización

Las sesiones creadas por versiones anteriores no tienen el nuevo vínculo de credenciales. Al publicar, los usuarios con sesión abierta deberán iniciar sesión una vez más. No se cambia su contraseña ni se necesita una migración de base.

La invalidación de sesiones sigue la recomendación de [OWASP para recuperación de contraseñas](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html). Los datos de sesión se guardan en el servidor, conforme al diseño de [express-session](https://expressjs.com/en/resources/middleware/session.html).

## Validación

`npm.cmd run test:checkout` incluye pruebas de contraseña oculta, rechazo de ejecución no interactiva, cuentas y entornos incorrectos, contraseña inválida o repetida, rollback, sesiones antiguas y recuperaciones concurrentes. Se ejecutan sobre cuentas ficticias de la base de pruebas. Durante esta implementación no se ha restablecido la contraseña de ningún administrador real.
