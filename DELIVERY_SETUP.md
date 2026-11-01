# Activar y comprobar las rutas de delivery

## Opción actual: tarifas fijas por ZIP, sin Google ni tarjeta

1. Actualiza el backend y, en desarrollo local, ejecuta `npm.cmd run db:delivery`
   desde `backend`. En Render, el arranque de staging aplica esta migración al
   volver a publicar. La migración conserva pedidos y configuración existentes.
2. Abre `/#admin/delivery` y selecciona **ZIP codes · fixed fees** en **Delivery pricing**.
3. Pulsa **Add ZIP code**, introduce los cinco dígitos y una tarifa aprobada por
   Andrea. Puedes añadir una etiqueta como Katy o Houston y cambiar o quitar filas.
   No se asignan códigos ni precios reales automáticamente.
4. Guarda la tabla y activa **Enable delivery at checkout** cuando haya al menos
   una tarifa completa. Se mantienen los horarios, las fechas bloqueadas, el
   mínimo de $14 solo para delivery y los límites de entregas.
5. Un ZIP no incluido ofrece contacto con Andrea para cotización personalizada,
   o pickup. La web no calcula millas ni confirma que la dirección pertenece al
   ZIP indicado: Andrea debe revisar la dirección del pedido antes de aceptarlo.

No se requiere dirección de salida ni `GOOGLE_ROUTES_API_KEY` en este modo.
Se admite ZIP+4, utilizando sus primeros cinco dígitos. Cambiar tarifas invalida
las cotizaciones aún no convertidas en pedido; los pedidos guardados conservan
su precio y la fuente de la tarifa. Las cotizaciones duran hasta 15 minutos.

Comprobación local, sin llamadas externas ni pedidos nuevos:

```powershell
npm.cmd run delivery:check
npm.cmd run delivery:check -- --zip "ZIP_APROBADO"
```

Sustituye `ZIP_APROBADO` por un código real de cinco dígitos que hayas configurado.
Puedes guardar un borrador de la tabla con delivery desactivado para revisarlo.
No puedes activar delivery con una tabla vacía o con ZIP duplicados.

## Alternativa futura: distancia real con Google

Las instrucciones siguientes se aplican exclusivamente al método **Road miles**.
No son necesarias para trabajar por ZIP.

Las tarifas, los horarios y la dirección de salida se gestionan en
`/#admin/delivery`. La dirección guardada en desarrollo no se copia a Render.
Este procedimiento no cambia los pagos de Stripe ni requiere SQL nuevo.

## 1. Preparar Google Cloud

1. Abre [Google Cloud Console](https://console.cloud.google.com/).
2. Selecciona o crea un proyecto para las pruebas de Sweet by Andre.
3. Vincula una cuenta de facturación. Routes API requiere facturación habilitada;
   las solicitudes se contabilizan por uso. Revisa sus límites antes de probar.
4. En **APIs & Services → Library**, busca y habilita **Routes API**.
5. En **APIs & Services → Credentials**, crea una **API key**.
6. En sus restricciones de API, permite únicamente **Routes API**. Es una clave
   del servidor: las restricciones de sitios web por HTTP referrer no corresponden
   a este flujo. Configura las restricciones de aplicación por IP con la IP de
   salida del servidor que hará las llamadas. Una clave restringida a la salida
   de Render puede no funcionar desde tu equipo local; usa claves separadas si
   necesitas ambos entornos.
7. Configura cuotas adecuadas para las pruebas en **Quotas & System Limits**.
   Las alertas de presupuesto sirven para avisar; no sustituyen una cuota.

Referencias: [configurar Routes API](https://developers.google.com/maps/documentation/routes/get-api-key),
[facturación y cuotas](https://developers.google.com/maps/documentation/routes/usage-and-billing)
y [restricciones de claves](https://cloud.google.com/api-keys/docs/add-restrictions-api-keys).

## 2. Guardar la clave solo en el backend

Para desarrollo local, completa esta variable en `backend/.env` y reinicia el
backend si estaba en ejecución:

```dotenv
GOOGLE_ROUTES_API_KEY=tu_clave
```

Para Render, añade la variable del mismo nombre en **Environment** del servicio
web y publica la actualización. No la pongas en `frontend/.env.local`, no uses
un prefijo `VITE_` y no la guardes en Git ni en mensajes del chat.

## 3. Comprobar sin activar delivery

Desde `backend`, ejecuta:

```powershell
npm.cmd run delivery:check
```

El comando comprueba la presencia de la dirección y la clave sin imprimirlas,
sin llamar a Google y sin modificar datos. Código de salida `2` significa que
falta configuración. La presencia de la clave todavía no prueba su autorización.

Cuando esté configurada, puedes medir una ruta desde la dirección privada
guardada hasta una dirección de prueba completa:

```powershell
npm.cmd run delivery:check -- --destination "Dirección completa de un lugar público, Katy, TX ZIP, USA"
```

Sustituye el texto de ejemplo por una dirección real. Esta modalidad realiza
una solicitud a Routes API y muestra la distancia por carretera y la tarifa
correspondiente. Puede usarse con delivery desactivado. No crea carritos,
pedidos ni cotizaciones guardadas, y no imprime la dirección de salida.

La prueba local necesita una clave autorizada para la conexión de tu equipo.
En Render Free, usa el checkout y el panel para probar el entorno publicado;
este comando local no comprueba las variables ni la conectividad de Render.

## 4. Activar y probar el checkout

1. Abre `/#admin/delivery` en el entorno que vas a probar.
2. Confirma la dirección privada de salida y las cuatro bandas de precio.
3. Verifica que el mínimo sea $14 solo para delivery y que pickup se coordine
   directamente. Un límite de entregas vacío significa que aún no hay un tope.
4. Activa delivery y guarda. En Render debes introducir la dirección aunque
   ya exista en la base local.
5. Con un carrito de al menos $14, elige delivery, una fecha disponible y una
   dirección real. Pulsa **Check delivery fee** y compara el resultado con una
   ruta de conducción equivalente en Google Maps.
6. Prueba una dirección cercana, otra más alejada y otra fuera de 15 millas.
   Las rutas que usa Google Maps pueden variar con sus opciones y el tráfico;
   el sistema solicita conducción sin información de tráfico. La tarifa se
   decide con los metros sin redondear, no con las millas mostradas.
7. Comprueba que cambiar la dirección elimina la tarifa anterior; con menos
   de $14 no se puede guardar delivery, mientras pickup sigue disponible.

Un resultado fuera del área ofrece cotización personalizada o pickup. Un fallo
de Google no produce delivery gratis. Las reglas de fechas, preparación y cupos
se comprueban otra vez en el backend al guardar el pedido.
