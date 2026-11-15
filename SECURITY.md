# Seguridad y mantenimiento

La revisión y sus límites están en [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

## Reportar un problema

Comunicarlo en privado al responsable técnico por el canal de entrega acordado.
No abrir un issue público con claves, cookies, datos de clientes ni instrucciones
que permitan acceder a pedidos reales. Incluir ruta afectada, comportamiento
esperado, pasos reproducibles con datos ficticios y el identificador de petición
`X-Request-ID`, si existe. No se ha habilitado un buzón público de seguridad.

Las pruebas ofensivas deben ejecutarse en una copia local aislada y con cuentas
de prueba. No ejecutar escáneres, pruebas de carga ni cobros contra producción
sin un alcance y una autorización específicos.

## Cambios y comprobaciones

Usar Node 24 y los archivos de bloqueo: `npm ci`, `npm ci --prefix backend` y
`npm ci --prefix frontend`. No versionar `node_modules`, archivos `.env`, cookies,
respaldos, claves privadas ni capturas con datos personales.

```powershell
npm audit --audit-level=moderate
npm audit --prefix backend --audit-level=moderate
npm audit --prefix frontend --audit-level=moderate
npm run security:hygiene --prefix backend -- --history
npm run lint --prefix frontend
npm run build --prefix frontend
npm run test:catalog --prefix frontend
npm run test:hosting --prefix frontend
npm run test:checkout --prefix backend
npm run test:staging --prefix backend
npm run test:deployment --prefix backend
npm run test:backup --prefix backend
```

Las pruebas de backend requieren PostgreSQL local y credenciales exclusivas de
pruebas. `test:checkout` exige `sweet_by_andre_test`; las pruebas de despliegue y
respaldo crean bases locales desechables y necesitan permiso `CREATE DATABASE`.
La prueba de respaldos necesita herramientas PostgreSQL compatibles (`PG_BIN`).
No copiar datos de clientes para preparar las pruebas.

El workflow `security.yml` reproduce los controles de dependencias, higiene,
frontend, checkout y despliegue usando PostgreSQL 18 desechable y credenciales
ficticias. No utiliza secretos del negocio. La restauración se comprueba aparte,
con las herramientas PostgreSQL instaladas. El workflow queda pendiente de su
primera ejecución en GitHub y de configurarlo como comprobación obligatoria de
la rama protegida. Dependabot propone actualizaciones semanales.

El escáner de higiene es complementario: reconoce algunos formatos de secretos,
no todos. Una coincidencia histórica real exige revocar o rotar la credencial;
borrar el archivo actual no soluciona su exposición. No reescribir el historial
compartido sin coordinarlo.

La contraseña PostgreSQL histórica documentada en el informe fue rotada y se
comprobó el rechazo de la anterior. `security-reviewed-history.json` registra
exclusivamente los tres blobs históricos cuya credencial se revocó, sin claves
ni hashes de contraseña. No reconoce una copia actual, otro blob ni otro tipo
de secreto. Cualquier nueva excepción requiere evidencia de revocación y revisión;
no desactivar el control para conseguir una ejecución verde.

## Incidentes

Ante acceso no autorizado, desactivar las funciones afectadas, preservar logs
sin difundir datos privados y revisar sesiones, administradores y operaciones
en los proveedores. Rotar las credenciales comprometidas y comprobar la
recuperación antes de reabrir. Registrar alcance, tiempos, medidas y responsables.
No activar pagos reales como parte de una prueba de seguridad.
