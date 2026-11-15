# Revisión de seguridad de Sweet by André

Fecha: 15 de noviembre de 2026. Estado: cambios implementados, publicados y
comprobados en staging; ver [STAGING_VALIDATION.md](STAGING_VALIDATION.md) para
resultados y pendientes de aceptación. Esta revisión
de código y pruebas adversariales reduce riesgos, pero no acredita ausencia de
vulnerabilidades ni certificación ASVS. No sustituye una evaluación independiente.

## Alcance y método

Se revisaron Express y React, rutas públicas y administrativas, sesiones, CSRF,
autorización por usuario/carrito, validación, SQL, imágenes, checkout, webhooks,
reembolsos, secretos, logs, dependencias y configuración de despliegue. Las pruebas
usan datos ficticios y PostgreSQL local aislado. No se realizaron ataques contra
Render ni pagos reales. No se operó sobre Docker Desktop, contenedores o datos de Ovvio.

Activos principales: acceso administrativo, datos personales y direcciones,
integridad del precio/pago/reembolso, disponibilidad y credenciales de proveedores.
Se consideran visitantes anónimos, compradores que manipulan peticiones,
sitios externos y cuentas o dependencias comprometidas. Los proveedores y la
configuración efectiva de sus cuentas quedan fuera de la comprobación local.

## Hallazgos y correcciones

La prioridad expresa el riesgo que se mitiga; no representa una clasificación
CVSS ni afirma explotación en el sitio publicado.

| Área                               | Prioridad | Resultado                                                                                                                                                                                                                                                                    |
| ---------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scripts y contenido externo        | Alta      | Helmet con CSP: scripts del mismo origen, sin scripts/eventos inline, sin marcos, objetos ni base externa; imágenes de Cloudinary y fuentes de Google permitidas explícitamente. Chrome verificó bloqueo de script insertado y escape de markup en el nombre de un producto. |
| Sesiones persistentes              | Alta      | Caducidad verificada en servidor: 30 minutos sin actividad y 8 horas absolutas; comprobación de versión de contraseña conservada; sesiones vencidas eliminadas y cookie retirada. Las sesiones anteriores al cambio requieren iniciar sesión de nuevo.                       |
| Abuso de operaciones               | Alta      | Cuotas persistentes y atómicas en PostgreSQL para API, carritos, pedidos, checkout, cotizaciones y archivos. Las cuotas por identidad de carrito/usuario siguen operando aunque cambie la IP. Fallo del almacén devuelve 503.                                                |
| Credenciales de invitado           | Media     | Expiran en servidor a los 30 días. Un token vencido no recupera el carrito antiguo; se crea otro sin borrar el historial de pedidos.                                                                                                                                         |
| Fuga de información en errores     | Alta      | Se sustituyeron errores completos de controladores por contexto fijo y códigos permitidos. JSON malformado, tamaños y codificaciones producen respuestas controladas sin stack, SQL ni mensajes del proveedor.                                                               |
| CSRF y origen                      | Alta      | Comprobación global de origen/Fetch Metadata en mutaciones, manteniendo CSRF por sesión/carrito. Logout exige sesión y token CSRF. Webhook conserva verificación de firma sobre cuerpo original.                                                                             |
| Catálogo oculto                    | Media     | Las rutas públicas de imágenes y variantes respetan producto disponible y categoría activa. El administrador dispone de ruta protegida para imágenes de productos ocultos.                                                                                                   |
| Archivos                           | Alta      | Carga reservada a admin + CSRF + cuota; un archivo de hasta 5 MB, sin campos adicionales; firma JPEG/PNG/WebP debe coincidir con MIME. URLs nuevas solo HTTPS Cloudinary, sin credenciales. Borrado restringido a la carpeta del proyecto en todos los entornos.             |
| Entradas y consumo de recursos     | Media     | JSON hasta 100 KB sin descompresión, límites de profundidad/complejidad, rechazo de claves de contaminación de prototipos, UUID antes de consultar SQL y máximo 100 líneas/1000 unidades por variante en carrito.                                                            |
| Cabeceras y caché                  | Media     | HSTS en entorno hospedado, nosniff, DENY, no-referrer, Permissions-Policy; API `no-store` y `Vary: Cookie`; identificador de petición generado por servidor y rutas sensibles rechazadas.                                                                                    |
| Registro público                   | Media     | Desactivado por defecto en staging/producción salvo `ENABLE_CUSTOMER_REGISTRATION=true`; compra como invitado conservada. Comparación bcrypt ficticia para emails inexistentes reduce diferencias temporales de login.                                                       |
| Entorno de Stripe                  | Alta      | Webhook firmado con modo incompatible se rechaza antes de procesar datos. Separación de claves test/live y bloqueo de pagos reales de producción conservados.                                                                                                                |
| TLS de proveedores                 | Alta      | Validadores hospedados rechazan `NODE_TLS_REJECT_UNAUTHORIZED=0`. No se desactiva la validación global de certificados. La conexión PostgreSQL efectiva requiere revisión del alojamiento; ver pendientes.                                                                   |
| Dependencias                       | Media     | Tres avisos moderados del árbol de herramientas frontend corregidos mediante actualización compatible del lockfile. Auditorías posteriores: cero avisos conocidos en raíz, backend y frontend. No equivale a ausencia de fallos desconocidos.                                |
| Repositorio y cadena de suministro | Media     | Retirados del índice 663 archivos de dependencias generadas y un archivo de cookies vacío. Permanecen en disco, ignorados; los lockfiles se conservan. CI con permisos de lectura, acciones fijadas por SHA y Dependabot semanal.                                            |

**Hallazgo de prioridad alta corregido:** tres versiones históricas de
`backend/.env.test` contenían una contraseña de PostgreSQL que coincidía con la
configuración local vigente. La coincidencia se comprobó en memoria sin mostrar
valores. Tras confirmar el usuario que la cuenta era exclusiva de este proyecto,
se generó una nueva contraseña aleatoria de 256 bits, se almacenó con SCRAM-SHA-256
en PostgreSQL y se actualizó únicamente `backend/.env`, que permanece ignorado.
Una conexión nueva verificó la credencial nueva; otra confirmó que la contraseña
anterior era rechazada. No se modificaron contenedores, datos de Ovvio ni credenciales de Render.
El archivo histórico apuntaba a una base local; no se ha establecido exposición
remota ni acceso indebido.

El análisis de 602 blobs históricos también detectó dos versiones de un valor
numérico ficticio de Stripe en ese archivo. Se exceptúa exclusivamente ese valor
y ruta históricos; no se exceptúan claves test reales ni la contraseña PostgreSQL.
El escáner ahora detecta también contraseñas en archivos de entorno. La revocación
de esos tres blobs inmutables se documentó en `security-reviewed-history.json`,
sin valores de credenciales. Solo se reconocen excepciones de ese tipo, ruta y
blob históricos, con estado revocado y fecha; nunca un archivo actual ni otra
clave. Las pruebas comprueban esos límites. Borrar un archivo o reescribir Git
no revoca credenciales.
El análisis por patrones no garantiza que nunca se hayan compartido otros secretos.

## Controles existentes revisados y conservados

- Contraseñas bcrypt, regeneración de sesión al iniciar sesión, cookies HttpOnly,
  Secure hospedadas y SameSite=Lax; revocación al cambiar contraseña o desactivar cuenta.
- Acceso administrativo comprobado en backend; pedidos y carritos autorizados
  por identidad de sesión o token del carrito, sin confiar en identificadores del cuerpo.
- Consultas con parámetros y validación de valores dinámicos. La revisión no
  demuestra matemáticamente ausencia de inyección en toda ejecución posible.
- Importes y disponibilidad calculados en servidor; idempotencia, transacciones
  y bloqueos para inventario/capacidad; pruebas de concurrencia existentes.
- Firma Stripe, asociación de sesión/intento/pedido, moneda/importe, entrega
  duplicada y expiración; la página de retorno nunca acredita el pago.
- Reembolso administrativo separado y explícito, limitado actualmente a sandbox;
  reconciliación y recuperación sin duplicar devolución de recursos.
- Inicio seguro con marcadores de base y checksums de migraciones; inicialización
  de producción cerrada y separada; restauración comprobada en base desechable.

## Validación

Última ejecución local, tras reinstalar backend y frontend desde sus lockfiles:

| Comprobación                                    | Resultado                                      |
| ----------------------------------------------- | ---------------------------------------------- |
| Checkout, autenticación y seguridad             | 136/136                                        |
| Staging                                         | 7/7                                            |
| Producción cerrada                              | 8/8                                            |
| Respaldos y restauración                        | 5/5                                            |
| Pruebas frontend de catálogo y hosting          | 3/3                                            |
| Lint y build frontend                           | Correctos                                      |
| Auditoría de dependencias raíz/backend/frontend | Cero avisos conocidos                          |
| Higiene del árbol actual                        | Sin coincidencias                              |
| Secretos en historial                           | Hallazgo PostgreSQL abierto; requiere rotación |

Los comandos reproducibles están en [SECURITY.md](SECURITY.md). La comprobación
local cubre checkout/autenticación/seguridad, inicialización staging, producción
cerrada, restauración, lint/build y tres pruebas frontend. El navegador verificó
catálogo móvil, alternativas de fotos, recuperación de imágenes y selección de
tamaños con CSP activa. Esto no comprueba todos los flujos administrativos en
navegador ni un despliegue efectivo de estos cambios.

La revisión de código debe incluir archivos nuevos y los cambios de rutas de
imágenes antes de desplegar. No hay una nueva migración de esquema en este cambio;
se reutiliza `auth_rate_limits`, instalada por `db:auth` y los inicializadores.

## Pendientes antes de abrir ventas reales

1. **Acceso y MFA — alto:** habilitar MFA en Stripe, Render, Cloudflare, Brevo y
   repositorio; definir propietarios y recuperación. El panel aún no implementa
   segundo factor propio. Protegerlo con una capa de identidad/MFA o implementar
   MFA antes de habilitar operaciones con dinero real. Evitar cuentas compartidas.
2. **Base de datos — alto:** verificar acceso privado, región y restricciones de
   red; retirar acceso externo amplio si no se necesita. Separar rol de migraciones
   del rol de ejecución y revisar privilegios. Verificar cifrado efectivo: Render
   usa certificados autofirmados en conexiones internas, por lo que no se puede
   imponer `rejectUnauthorized=true` allí sin un diseño de confianza compatible.
   No resolver un fallo desactivando TLS globalmente. Para conexión externa, usar
   TLS con verificación de certificados; comprobar también parámetros de la URL.
3. **Disponibilidad — alto:** configurar protección de borde/WAF y alertas de
   abuso/costes. Validar la cadena real de proxies (`trust proxy=1`) y que no se
   pueda falsificar la IP o acceder por un camino más corto al servidor. La cuota
   en aplicación no detiene DDoS ni ataques distribuidos con muchas identidades.
4. **Alertas y auditoría — alto:** monitorizar errores 5xx/429/503, fallos de
   webhooks, reembolsos, accesos y respaldos. Falta un registro de auditoría
   administrativo centralizado e inmutable. Definir destinatario y respuesta.
5. **Datos y recuperación — alto:** copias automáticas cifradas fuera del servicio,
   acceso limitado, retención y restauración periódica. Establecer plazos de
   borrado de datos personales y logs. Revisar obligaciones aplicables con la dueña.
6. **Secretos y proveedores — alto:** mantener claves distintas por entorno y privilegios
   mínimos; comprobar inventario y rotación en cada cuenta, destinatarios de correo,
   restricciones de Google Routes y carpeta Cloudinary exclusiva. No se inspeccionó
   la configuración privada de esas cuentas.
7. **Cambios y pruebas — medio:** ejecutar el workflow en GitHub, activar protección
   de rama y revisión; analizar imagen del contenedor y fijar estrategia de parches.
   Repetir en staging login/logout/expiración, compra, webhook, reembolso de prueba,
   carga de imagen y administración de productos ocultos. El navegador local probado
   usa la política del backend pero respuestas de catálogo simuladas.
8. **Revisión independiente — alto:** pentest con alcance autorizado antes del
   lanzamiento de pagos reales; incluir autorización entre cuentas, abusos de
   negocio, configuración efectiva y cadena de proveedores. El ciclo de pagos live
   todavía necesita una validación separada.

## Límites operativos introducidos

Todas las cuotas siguientes usan ventanas de 15 minutos y aplican en staging y
producción. Login/registro conservan su protección también en desarrollo.

| Operación                    | Por IP |         Por carrito/usuario |
| ---------------------------- | -----: | --------------------------: |
| API general                  |   1000 |                           — |
| Crear carrito invitado       |     30 |                           — |
| Crear pedido                 |     60 |                          10 |
| Iniciar/reanudar checkout    |     60 |                          20 |
| Cotización de delivery       |     50 |                          20 |
| Carga de imagen              |     20 |                          20 |
| Login                        |     30 | 10 por combinación IP/email |
| Registro, si está habilitado |     10 |  5 por combinación IP/email |

Las firmas de Stripe se comprueban sin pasar por las cuotas de navegador para
permitir reintentos legítimos. Los cuerpos del webhook siguen limitados a 100 KB.
Las cuotas se deben ajustar con métricas, teniendo en cuenta redes compartidas.
Login distribuido y creación distribuida de carritos necesitan la protección de
borde; las cuotas por IP no sustituyen MFA.

La CSP permite atributos de estilo inline para el posicionamiento de componentes
React, pero no scripts inline. Si se añade otro proveedor de imágenes, fuentes,
scripts o conexiones, hay que revisar la política explícitamente. El carrito
invitado deja de servir como credencial de seguimiento al vencer sus 30 días;
la atención de pedidos antiguos debe gestionarse por un canal verificado.

## Referencias

- [OWASP ASVS](https://asvs.owasp.org/): referencia de áreas y controles; sin declaración de conformidad.
- [Seguridad de Express](https://expressjs.com/en/advanced/best-practice-security/).
- [Cabeceras Helmet](https://helmetjs.github.io/).
- [Verificación de webhooks Stripe](https://docs.stripe.com/webhooks).
- [Conexiones PostgreSQL en Render](https://render.com/docs/postgresql-creating-connecting).
