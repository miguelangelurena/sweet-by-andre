# Preparación para producción

Estado de esta revisión: 15 de noviembre de 2026. El entorno publicado conocido es staging. Este documento organiza los pendientes; no activa producción ni confirma servicios externos que no se han revisado en sus cuentas.

## Separación de entornos

| Recurso    | Staging actual o configuración versionada                                                   | Producción por preparar                                                                    |
| ---------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Aplicación | `sweet-by-andre-staging.onrender.com`, Docker con `APP_ENV=staging`                         | Configuración y arranque preparados; servicio real pendiente                               |
| Base       | Base de staging; inicializador con catálogo demo                                            | Inicializador sin demo y migraciones con checksum probados localmente; base real pendiente |
| Datos      | Pedidos y pagos de pruebas                                                                  | Sin sesiones, pagos ni pedidos de sandbox importados                                       |
| Stripe     | Claves test, webhook de staging, reembolsos limitados a sandbox                             | Cuenta habilitada, secretos y webhook live propios; revisar soporte de reembolsos reales   |
| Brevo      | Código preparado; envío externo pendiente                                                   | Dominio autenticado, remitente confirmado y credenciales del negocio                       |
| Fotos      | Integración preparada; faltan las credenciales de Cloudinary y repetir la carga/eliminación | Cuenta del negocio, carpeta y credenciales con alcance definido para producción            |
| Dominio    | URL de Render                                                                               | `sweetsbyandre.com`, DNS y HTTPS verificados                                               |
| Copias     | Herramientas locales y restauración probadas                                                | Recuperación del proveedor, almacenamiento externo, programación y alertas                 |
| Monitoreo  | `/api/health` comprueba PostgreSQL                                                          | Monitor externo y responsable de recibir alertas                                           |

No reutilizar `SESSION_SECRET`, `CSRF_SECRET`, contraseña administrativa, conexión de base o secretos de webhook entre staging y producción.

## Cambios técnicos necesarios antes de crear el entorno final

- Las imágenes Docker de ambos entornos ya pasaron la validación con PostgreSQL 18 temporal, primer arranque, login y reinicio. Repetir `npm.cmd run test:docker` cuando cambien la imagen o la inicialización.
- Crear el servicio y la base separados con la configuración de [PRODUCTION_SETUP.md](PRODUCTION_SETUP.md). El inicializador de producción ya crea al administrador, mantiene el catálogo vacío y rechaza bases de staging; no usa `startStaging.js`.
- Cargar el catálogo aprobado desde el panel o preparar una importación selectiva revisada, sin usuarios, sesiones ni pedidos de pruebas.
- Mantener frontend y backend en el mismo origen HTTPS. Configurar `FRONTEND_URL` con el origen final y comprobar cookies seguras, CORS, CSRF y la cadena real de proxies.
- Aplicar las migraciones, incluida `auth-security.sql`, antes de aceptar tráfico. Publicar frontend y backend compatibles: las modificaciones del catálogo ahora exigen CSRF.
- Revisar la activación live de Stripe y los reembolsos. El guard actual de reembolsos rechaza claves reales; cambiar una variable no completa este trabajo.
- Mantener `SITE_INDEXABLE=false` durante la preparación. El banner de staging ya se excluye de la compilación de producción; confirmar los textos y la indexación para el lanzamiento final.
- Validar con la dueña la recuperación asistida de [ADMIN_ACCESS_RECOVERY.md](ADMIN_ACCESS_RECOVERY.md) y acordar el canal de soporte. El comando ya restablece una cuenta existente e invalida sesiones; la recuperación automática por correo sigue pendiente.

## Requisitos operativos

- Configurar servicio y base adecuados para producción. El Blueprint versionado usa Free; Render recomienda no usar esas instancias para aplicaciones de producción. [Limitaciones oficiales](https://render.com/docs/free).
- Implementar la programación y almacenamiento externo descritos en [BACKUPS.md](BACKUPS.md), y probar una restauración del entorno contratado.
- Configurar un monitor HTTPS externo de `/api/health`, por ejemplo cada 5 minutos, con alertas al responsable tras fallos consecutivos. Este endpoint no comprueba Stripe, Brevo, webhooks ni el worker.
- Vigilar fallos de login, HTTP 5xx, entregas de webhooks, reembolsos pendientes o fallidos y trabajos de correo `failed` o `uncertain`. Definir revisión y escalamiento; no están conectados aún a un sistema de alertas.
- Comprobar que el worker de notificaciones dispone de ejecución continua o moverlo a un servicio independiente. Un proceso dentro de una aplicación que duerme no garantiza puntualidad.
- Conservar logs sin claves ni datos completos de clientes. Definir retención y responsables.

## Confirmaciones de la dueña

La creación de su cuenta de fotos está delegada mediante la
[guía para Andrea](docs/clienta/CREAR_CUENTA_CLOUDINARY.pdf). Puede confirmar el
registro sin enviar contraseñas ni claves. Mientras responde, se puede continuar
con revisiones de accesibilidad/móvil y preparación operativa. La configuración
real de respaldos y alertas requiere el acceso al hosting y el plan aprobado,
pero no depende de Cloudinary ni de Brevo.

- Correo de la dueña confirmado por el usuario el 16 de noviembre de 2026:
  `sweetbyandre@gmail.com`. Queda confirmar la titularidad efectiva de las cuentas,
  sus verificaciones en cada proveedor y las personas con acceso.
- Cuenta Stripe y datos del negocio habilitados para cobros reales.
- Impuestos y reglas comerciales aplicables: el código calcula impuestos en cero; no se ha confirmado que corresponda al negocio.
- Precios, tamaños, alérgenos, anticipación, capacidad de preparación, ZIP y tarifas de delivery, y horarios de pickup.
- Políticas de aceptación, cancelación, reembolsos y privacidad, con textos aprobados.
- Presupuesto de hosting, dominio, correo y almacenamiento, objetivos de recuperación y soporte después de la entrega.

Estas confirmaciones se pueden trabajar en paralelo; los requisitos fiscales y de operación deben validarse con quien corresponda para la actividad y ubicación del negocio.

## Aceptación final

1. Pruebas automatizadas y compilación de la versión que se publicará.
2. Prueba visual del catálogo y panel: filtros, variantes, precios y carga de imágenes.
3. Compra controlada en el dominio final, confirmada por webhook, con correo recibido y estados de preparación correctos.
4. Cancelación, reintento, rechazo y reembolso verificados en el entorno que corresponda. Cualquier movimiento de dinero real requiere una prueba acordada previamente.
5. Restauración comprobada, alertas recibidas y acceso de la dueña verificado.
6. Entrega de guía de uso, accesos en gestor de contraseñas, repositorio, responsables y condiciones de mantenimiento.

El despliegue final queda pendiente hasta resolver los bloqueos anteriores. No se han creado recursos de pago, cambiado DNS ni activado cobros reales durante esta preparación.
