# Revisión del catálogo — pendiente de aprobación comercial

Consulta del catálogo público de staging: 15 de noviembre de 2026. Los precios siguientes son los observados en la página; todavía deben confirmarse con Andrea. Esta revisión no modifica productos, importes, fotos ni pedidos guardados.

Se revisaron **7 productos, 69 variantes disponibles y 10 fotos**. Los precios “desde” coinciden con el mínimo de las variantes públicas y las 10 fotos respondieron HTTP 200 como imágenes. No se encontraron precios no positivos ni combinaciones duplicadas entre las variantes públicas consultadas.

Los productos ocultos y las variantes pausadas quedan fuera de esta consulta pública. Su revisión debe completarse desde administración antes de aprobar el catálogo definitivo.

## Resumen

| Producto | Desde USD | Variantes disponibles | Fotos | Revisión pendiente |
| --- | ---: | ---: | ---: | --- |
| Brownies Bites | 2.49 | 7 | 0 | Foto, nombre y paquetes de 24/36 |
| Cheesecake | 8.99 | 20 | 1 | Sabores, tamaños y foto representativa |
| Chocoflan | 6.99 | 4 | 1 | Precios por tamaño y carga de preparación |
| Cookies | 1.49 | 24 | 1 | Sabores y cantidades por paquete |
| Flan / Quesillo | 6.99 | 4 | 3 | Tamaños, precios y fotos |
| Mini Chocoflan | 1.99 | 6 | 2 | Cantidades, precios y fotos |
| Tres Leches Cake | 6.99 | 4 | 2 | Tamaños, precios y fotos |

La [hoja de precios por variante](docs/catalog-prices-review.csv) contiene las 69 configuraciones con su ID y una columna de aprobación. Es una hoja de revisión: editarla no cambia la base de datos ni constituye una importación al sitio.

## Decisiones que necesita Andrea

### Brownies Bites

No tiene fotografía cargada. Hay que proporcionar una foto propia aprobada; mientras tanto se muestra el espacio de marca.

| Paquete | Precio observado USD |
| --- | ---: |
| 1 | 2.49 |
| 4 | 8.99 |
| 6 | 12.99 |
| 8 | 16.99 |
| 12 | 23.99 |
| 24 | 44.99 |
| 36 | 33.99 |

El paquete de 36 cuesta menos que el de 24. Puede ser una promoción o un dato equivocado; confirmar ambos importes antes de cambiarlos. También debe confirmarse el nombre público **Brownies Bites** y que el número de cada paquete sea su cantidad de unidades.

### Cheesecake y fotos por variante

La fotografía actual muestra porciones individuales con fruta; el mismo archivo se muestra al elegir distintos sabores y tamaños. Confirmar si es representativa y si hacen falta fotos adicionales. La galería actual pertenece al producto, no a cada variante.

Las combinaciones públicas incluyen cinco sabores y tamaños de 4, 6, 8 y 10 pulgadas. Andrea debe confirmar que estén aprobados todos los sabores, las medidas y los precios del CSV.

### Preparación y descripciones

Las 69 variantes observadas tienen **1 punto de preparación**. Confirmar la carga real por tamaño y paquete; un pastel grande no tiene por qué consumir lo mismo que una unidad pequeña. No se cambiaron esos valores.

Revisar descripciones, ingredientes, alérgenos, porciones y conservación con la dueña. No se añadieron afirmaciones nuevas sobre esos datos ni se dedujeron de las fotos o del nombre del producto.

## Ajustes técnicos preparados

- La ficha comienza con la variante disponible de menor precio, de forma coherente con “From” en el catálogo. Si hay empate conserva el orden existente de las variantes.
- Una imagen ausente o que falla muestra un espacio de marca o un mensaje alternativo, en lugar del icono de imagen rota. La foto original sigue guardada.
- Se comprobó en Chrome el catálogo a 390 px sin desbordamiento horizontal, la selección inicial de Brownies en $2.49 y Cheesecake en $8.99, el cambio de Cheesecake a 6 pulgadas en $19.99 para el sabor seleccionado y la recuperación de imágenes tras volver a estar disponibles.
- La prueba de fotos fallidas usó una copia local del catálogo y bloqueos de red del navegador; no alteró las fotos ni la información de Render.

## Repetir la consulta

Desde `backend`:

```powershell
npm.cmd run catalog:audit
```

El comando consulta únicamente endpoints públicos con GET y HEAD. No carga credenciales, no usa Docker y no accede a bases privadas. Crea una carpeta nueva en `tmp/catalog-review` con el inventario, hallazgos y CSV para revisión. No sobrescribe esta hoja de aprobación ni cambia los datos del negocio. Los datos pueden cambiar si se edita el catálogo durante la consulta; repetirla tras las últimas ediciones antes de aprobar.

La aprobación final debe incluir también el catálogo oculto, el orden de las fotos y los cambios de disponibilidad desde el panel administrativo.
