# Guía de uso — Sweet by André

Esta guía explica el panel actual. El sitio publicado conocido es de pruebas: `https://sweet-by-andre-staging.onrender.com`. La dirección definitiva y la activación de cobros y correos se confirmarán antes de la entrega.

## Entrar y salir

Abre `/#admin/login` en el sitio indicado por el responsable técnico. Escribe tu correo y contraseña y pulsa **Sign In**. Usa el acceso guardado en tu gestor de contraseñas.

Para salir, pulsa **Sign out** en el menú del panel. **View website** abre la tienda y mantiene la sesión iniciada. Si el acceso caduca, vuelve a iniciar sesión.

Si olvidaste la contraseña, contacta al responsable de soporte. La recuperación actual es asistida; todavía no se envía un enlace de recuperación por correo. No compartas tu contraseña por mensajes.

## Menú del panel

| Sección | Para qué sirve |
| --- | --- |
| **Dashboard** | Revisar el resumen operativo |
| **Products** | Productos, categorías, variantes, precios y fotos |
| **Orders** | Revisar pedidos, aceptar y avanzar su preparación |
| **Seasonal** | Editar las colecciones de temporada disponibles |
| **Delivery & pickup** | Entrega, recogida, horarios y tarifas |
| **Preparation & capacity** | Capacidad de trabajo y carga de cada producto |

## Revisar un pedido

En **Orders**, abre el pedido y revisa productos, tamaños, cantidades, notas, fecha, método de entrega, contacto y total. El panel distingue dos estados:

| Pago | Qué significa |
| --- | --- |
| `pending` | El sistema todavía no confirma el pago |
| `paid` | El sistema confirmó el pago |
| `refund_pending` | Hay un reembolso por resolver o revisar |
| `refunded` | El reembolso fue confirmado |
| `failed` | El pago figura fallido; requiere revisar el pedido antes de actuar |

Un pedido `paid` y `pending` puede estar pagado y seguir esperando aceptación de la pastelería. Son estados distintos. La página de retorno de Stripe y una captura del cliente no sustituyen el estado confirmado por el sistema.

Si la información no se actualiza, recarga el pedido y consulta al responsable técnico con su ID. Si el cliente ya pagó, revisa ese pedido antes de pedirle otro pago.

## Aceptar y preparar

Cuando el pedido esté pagado y puedas cumplirlo, sigue esta secuencia:

1. **Accept order** → `confirmed`: aceptas el pedido.
2. **Start preparing** → `preparing`: comienza su preparación.
3. **Mark as ready** → `ready`: está listo para recoger o entregar.
4. **Mark as completed** → `completed`: el cliente ya lo recibió. Confirma **Complete order** cuando corresponda.

Los cambios se guardan inmediatamente. Comprueba la información antes de avanzar; el panel permite seguir la secuencia hacia adelante. Coordina las instrucciones de entrega o recogida con el cliente.

Los correos dependen de que se haya activado y validado el servicio. Hasta entonces, coordina los avisos por el canal habitual del negocio.

## Cancelar o rechazar

**Pedido sin pago confirmado:** el panel puede ofrecer **Cancel unpaid order**. Revisa el ID y confirma **Cancel request**. El pedido permanece en el historial. Si hay una sesión de pago activa o un estado incierto, el sistema puede bloquear la cancelación; consulta soporte.

**Pedido pagado que aún espera aceptación:** **Check refund status** solo consulta el estado, no emite un reembolso. Cuando la función esté habilitada y el pedido sea elegible, escribe el motivo, pulsa **Reject and refund in full** y revisa ID e importe antes de **Confirm full refund**.

Espera la confirmación del reembolso. Si queda pendiente o aparece un error, consulta su estado antes de volver a intentar. Un pedido ya aceptado necesita revisión por soporte para una cancelación o devolución.

Los reembolsos del panel se han validado en sandbox. En la configuración de producción preparada están desactivados hasta completar su activación y validación. No utilices las pruebas como movimientos de dinero real.

## Productos, variantes y fotos

En **Products**, usa **+ Add Product** para crear un producto y **Edit** para modificarlo. Revisa nombre, descripción, categoría, precio y disponibilidad antes de guardar.

Cada tamaño o combinación puede tener su propio precio. En la matriz de variantes, ajusta el valor y pulsa **Save changes**. Confirma que el tamaño seleccionado sea el correcto y revisa el resultado en la tienda.

**Hide from store** pausa un producto; **Show in store** lo vuelve a mostrar. Ocultar productos o categorías conserva sus registros y los pedidos históricos. Para las categorías, abre **Categories** y usa las acciones para añadir, renombrar, ocultar o restaurar.

En **Photos**, añade una imagen JPG, PNG o WebP de hasta 5 MB. Revisa la vista previa y pulsa **Upload Image**. Puedes elegir la foto principal desde la galería. Confirma cuidadosamente antes de eliminar una imagen.

## Capacidad de preparación

En **Preparation & capacity**, configura los días de trabajo, la capacidad y las excepciones por fecha. Guarda con **Save preparation calendar**. Las fechas y horas de servicio se interpretan en la zona horaria de Houston.

Para un producto **Made to order**, los puntos representan trabajo de preparación. Por ejemplo, si una variante requiere 2 puntos y un día tiene capacidad de 10, cinco unidades ocupan esos 10 puntos, antes de considerar otros pedidos. No son unidades físicas de inventario.

Configura los puntos por variante y pulsa **Save product settings**. Cambiar los puntos afecta pedidos nuevos; los pedidos existentes mantienen su carga original. Los productos de stock físico se gestionan por unidades en **Products**.

Las reservas temporales y los pedidos pagados ocupan capacidad. Completar un pedido no borra el trabajo realizado de ese día. La liberación por cancelación o reembolso depende de su estado confirmado; consulta al soporte si los valores parecen incorrectos.

En una base nueva de producción los días empiezan cerrados. Deben configurarse con la disponibilidad real antes de recibir pedidos.

## Delivery y pickup

En **Delivery & pickup**, revisa horarios, excepciones, mínimo de compra y tarifas antes de habilitar delivery.

El método **ZIP codes · fixed fees** permite establecer tarifas por código postal sin Google. Un ZIP sin tarifa no recibe automáticamente entrega gratis. Configura solo las zonas y los importes aprobados por el negocio.

El método por distancia de carretera necesita configuración técnica adicional. Coordina cualquier cambio de dirección de salida o integración con el responsable técnico. El mínimo de anticipación para pedidos es de 48 horas.

## Colecciones de temporada

En **Seasonal**, abre una colección con **Edit +**, modifica su título, descripción y productos, y guarda. Crear productos en **Products** permite seleccionarlos aquí. Revisa también su disponibilidad en la tienda.

## Rutina diaria

- Revisar pedidos nuevos y separar pago confirmado de aceptación pendiente.
- Confirmar qué pedidos puedes cumplir y avanzar cada uno al estado real.
- Revisar disponibilidad, capacidad por fecha y cierres necesarios.
- Comprobar que el cliente tenga las instrucciones de entrega o recogida.
- Cerrar sesión al terminar, especialmente en un equipo compartido.

Para pedir ayuda, envía el ID del pedido, el mensaje que aparece, el entorno utilizado y la acción que intentabas realizar. No envíes contraseñas, claves de servicios ni datos de tarjetas.

Antes de la entrega final se completarán la dirección definitiva, el correo correcto y el canal de soporte acordado.
