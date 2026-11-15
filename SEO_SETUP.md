# SEO de Sweet by André

Revisión técnica del 15 de noviembre de 2026. Cambios publicados y comprobados
en staging; producción y envío a Google siguen pendientes. No se activó la
indexación, no se modificó DNS y no se crearon cuentas o fichas del negocio.

## Implementado

- URLs públicas independientes: `/`, `/catalog`, `/seasonal` y
  `/products/<uuid>/<nombre-del-producto>`. El identificador mantiene el enlace
  estable; nombres antiguos redirigen con 301 a la URL actual. Los antiguos
  enlaces `/#catalog`, `/#seasonal` y `/#product/<uuid>` se migran en el navegador,
  conservando compatibilidad con marcadores anteriores. El fragmento no llega
  al servidor: esta migración no puede ser una redirección HTTP del fragmento.
- HTML inicial con contenido público, títulos y descripciones por página,
  canonical sin parámetros de seguimiento y enlaces rastreables. Express lo
  entrega igual a personas, buscadores y vistas previas; React monta después
  los controles interactivos. No hay detección de bots ni contenido oculto.
- Open Graph y Twitter Cards, imagen social propia basada en una foto existente,
  idioma inglés y datos estructurados `Organization`, `WebSite`, `WebPage`,
  `Product`, `AggregateOffer`, `BreadcrumbList` e `ItemList` según la página.
  Precios, visibilidad y disponibilidad proceden de la misma consulta que usa
  la API pública; no se inventaron reseñas, puntuaciones, promociones o fechas.
  Los productos hechos por encargo no se anuncian como stock inmediato.
- Sitemap dinámico con portada, catálogo, temporada y productos publicados
  de categorías activas. Excluye administración, carrito, checkout y retorno
  de pagos. No fabrica fechas `lastmod` ni prioridades.
- `robots.txt` según entorno; staging permanece bloqueado incluso si alguien
  configura `SITE_INDEXABLE=true`. Producción necesita habilitación explícita.
  Páginas privadas reciben `noindex`, sin canonical ni datos personales en HTML;
  sus vistas con fragmentos también retiran metadatos públicos en el navegador.
- Productos no públicos y rutas inexistentes devuelven 404 real. Un fallo de
  datos del catálogo devuelve 503 y `Retry-After`, evitando páginas vacías con 200.
  `index.html` redirige a `/`; parámetros de campañas no cambian el canonical.
- Encabezados y texto local para Katy, Texas, y servicio en Katy/Houston conforme
  al contenido existente. Una sola cabecera H1 para catálogo y temporada.
- Imágenes WebP, carga diferida de imágenes secundarias y prioridad alta para
  imágenes principales; preload del hero generado desde el manifest de Vite.
  Código administrativo, carrito y checkout dividido en paquetes bajo demanda.
- Escape de HTML/JSON-LD y nonce para los datos estructurados, conservando CSP.
  Cuota persistente de 1000 páginas dinámicas por IP y 15 minutos en entornos
  hospedados para catálogo, productos y sitemap; no sustituye protección de borde.

La aplicación de Vite por sí sola sigue llevando `noindex`: el HTML indexable
debe servirse a través de Express (`SERVE_FRONTEND=true`). No publicar únicamente
`frontend/dist` en un hosting estático esperando las mismas capacidades SEO.

En staging, si no se define `SITE_URL` ni `FRONTEND_URL`, los metadatos usan la
URL HTTPS proporcionada por Render o Railway. Esta alternativa mantiene `noindex`
y no habilita la indexación de producción, que exige un origen explícito.

## Rendimiento comprobado

| Recurso                            |      Antes |   Después |
| ---------------------------------- | ---------: | --------: |
| JavaScript inicial, sin gzip       |  435.86 KB | 273.60 KB |
| JavaScript inicial, con gzip       |  117.96 KB |  83.64 KB |
| Imagen principal con transparencia | 1869.23 KB | 284.28 KB |

Se conservaron las imágenes originales y se usan las copias WebP optimizadas.
No se añadieron dependencias para convertirlas en cada despliegue. La imagen
social es JPEG de 1200 × 630. Estas cifras son tamaños de archivos, no una
medición de Core Web Vitals ni una puntuación Lighthouse.

## Habilitación en el dominio final

1. Confirmar con la dueña el dominio escrito exactamente: el último indicado
   en Cloudflare es `sweetsbyandre.com`, con **sweets** en plural. No cambiarlo
   al nombre singular por intuición. Confirmar también marca, contacto y área
   de servicio; hay una diferencia pendiente entre las variantes del Gmail.
2. Completar despliegue de producción separado y comprobar HTTPS, seguridad,
   disponibilidad y aceptación. Mantener `SITE_INDEXABLE=false` hasta entonces.
3. Establecer `FRONTEND_URL=https://sweetsbyandre.com` solo cuando ese sea el
   origen definitivo. `SITE_URL` es opcional: vacío usa `FRONTEND_URL`; si se
   utiliza, debe contener exclusivamente el origen HTTPS canonical, sin ruta,
   usuario, contraseña ni parámetros. No se toma el host de la petición para
   construir canonical o sitemap.
4. Configurar una redirección permanente de www al dominio elegido, o a la
   inversa, y de HTTP a HTTPS en la plataforma. Revisar también el acceso por
   la URL de Render. Evitar un bucle o dos dominios indexables con el mismo sitio.
5. Una vez aprobado el lanzamiento, usar `APP_ENV=production` y
   `SITE_INDEXABLE=true`, y reiniciar/redeployar. Esto **no activa pagos** ni
   notificaciones. Staging se mantiene con `APP_ENV=staging`.
6. Verificar en el dominio final `robots.txt` y `sitemap.xml`, canonical de cada
   página y ausencia de `X-Robots-Tag: noindex` en páginas públicas. Carrito,
   administración, errores y resultados de pago deben continuar fuera del índice.
7. Verificar una propiedad de dominio en Google Search Console mediante el TXT
   que proporcione esa cuenta y presentar `/sitemap.xml`. No reutilizar un TXT
   de otro negocio. Inspeccionar portada, catálogo y al menos dos productos con
   la prueba de URL publicada y comprobar el HTML renderizado.
8. Validar páginas de producto con Rich Results Test. Pueden existir advertencias
   por propiedades opcionales; no completarlas con datos inventados. Los datos
   estructurados permiten optar a resultados enriquecidos, sin garantizar su
   aparición. Véase [documentación de Google sobre productos](https://developers.google.com/search/docs/appearance/structured-data/product-snippet).

Los bloqueos de robots no son un control de acceso. Si una URL de preview ya
estuviera indexada, impedir su rastreo puede impedir que Google lea su `noindex`;
revisar esa situación en Search Console antes de modificar las reglas. No activar
staging para intentar conseguir tráfico.

## Contenido y SEO local pendientes con la dueña

- Revisar las descripciones de cada producto: sabor, ingredientes relevantes,
  tamaño, porciones y conservación, sin atribuir propiedades no confirmadas.
  Confirmar alérgenos y evitar promesas de ausencia de contaminación cruzada.
- Completar fotos faltantes y confirmar los precios pendientes de
  [CATALOG_REVIEW.md](CATALOG_REVIEW.md). El trabajo SEO no modifica precios.
- Confirmar preguntas frecuentes útiles: anticipación mínima, recogida, zonas y
  tarifas de entrega, pedidos especiales y políticas de cambios/cancelación.
  No publicar respuestas antes de acordar las condiciones del negocio.
- Revisar elegibilidad para Google Business Profile como negocio de área de
  servicio y la forma correcta de ocultar una dirección residencial. No publicar
  una dirección inventada o privada para completar schema `LocalBusiness`.
  Por ahora se usa `Organization` sin dirección ni horarios no confirmados.
- Alinear nombre, teléfono, contacto y enlaces sociales reales en sitio y ficha.
  No se añadieron perfiles sociales no confirmados, reseñas propias o backlinks
  artificiales. No se generaron páginas repetidas para cada ciudad.
- Si se prepara una versión española, debe tener contenido completo y URLs
  propias antes de añadir `hreflang`; hoy el sitio sigue en inglés.

## Medición y mantenimiento

Comprobar cobertura, canonical elegido, búsquedas y clics en Search Console.
Medir Core Web Vitals y Lighthouse móvil en producción, distinguiendo datos de
campo de mediciones de laboratorio y el arranque en frío de Render. No se instaló
analítica que añada seguimiento sin decidir antes las necesidades de privacidad.
Tras cambiar nombres, precios, disponibilidad o fotografías, revisar HTML, API,
datos estructurados y sitemap. Las consultas son actuales, sin snapshots del
catálogo para SEO.

## Comprobaciones ejecutadas

- Backend: 134 pruebas de seguridad, autenticación, catálogo/SEO, checkout,
  inventario, webhooks y reembolsos aprobadas.
- Staging: 7 pruebas; producción cerrada: 8 pruebas aprobadas.
- Frontend: lint/build, pruebas de URLs SEO y regresiones de catálogo/hosting.
- Chrome local con catálogo simulado: migración de enlaces antiguos, canonical,
  JSON-LD, cambio de tamaño y precio, privacidad del carrito, restauración de
  metadatos al volver, 404, catálogo móvil sin desbordamiento e imágenes WebP.
  La CSP sigue bloqueando scripts insertados.

```powershell
npm run test:checkout --prefix backend
npm run test:staging --prefix backend
npm run test:deployment --prefix backend
npm run lint --prefix frontend
npm run build --prefix frontend
npm run test:seo --prefix frontend
npm run test:catalog --prefix frontend
npm run test:hosting --prefix frontend
```

Las pruebas de backend requieren exclusivamente bases PostgreSQL locales de
prueba. CI incluye los nuevos casos. El resultado publicado está en
[STAGING_VALIDATION.md](STAGING_VALIDATION.md). Falta ejecutar el workflow en
GitHub y validar producción. No se han medido posiciones ni tráfico todavía.

Las URLs rastreables y el contenido servido inicialmente siguen las recomendaciones
de [Google para aplicaciones JavaScript](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
y [estructura de URLs de comercio electrónico](https://developers.google.com/search/docs/specialty/ecommerce/designing-a-url-structure-for-ecommerce-sites).
