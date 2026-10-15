// Genera el link de WhatsApp (click-to-chat) con el mensaje y el pedido ya listos.
// No envía nada automáticamente: el taller recibe el link por correo (o en la
// respuesta de la API) y con un toque abre el chat del cliente en su WhatsApp
// Business normal, con el mensaje pre-escrito. Cuando se quiera automatizar el
// 100% del envío, este archivo es el que se reemplaza por una llamada a la
// Cloud API de Meta (o un proveedor como Twilio/360dialog) — el resto del
// backend no cambia.

// Datos de transferencia bancaria tal cual se le envían siempre al cliente.
// Fijos aquí (no cambian por pedido) — si alguna vez cambia una cuenta, se
// edita solo este bloque.
const DATOS_TRANSFERENCIA =
  `Forma de pago: transferencia 🌐\n\n` +
  `▪️Banco Popular\n780341491\nCuenta corriente\n\n` +
  `▪️Qik\n1007970249\nCuenta ahorros\n\n` +
  `▪️BHD\n16054610023\nCuenta corriente\nCarlos Cornielle\nCed.: 402-2010529-6\n\n` +
  `🔹Ban Reservas\n9603050148\nCuenta de ahorros\nLesbia Camila Chávez\nCed: 402-2045802-6`;

// El campo "WhatsApp" del formulario pide el número tal cual se marca en el
// país (ej. "809 000 0000", placeholder sin código de país) — así que llega
// aquí como 10 dígitos. wa.me necesita el número completo CON código de
// país (1, el mismo de EE.UU./Canadá — República Dominicana usa el plan de
// numeración NANP) para abrir el chat con la persona correcta; sin él,
// wa.me interpreta mal el número. Si en algún momento llega ya con código
// de país (11 dígitos empezando en 1, o un número de otro país), se deja
// tal cual.
function telefonoConCodigoPais(telefono) {
  const digitos = (telefono || "").replace(/[^\d]/g, "");
  if (digitos.length === 10) return `1${digitos}`;
  return digitos;
}

function linkWhatsApp(pedido, urlPdf) {
  const telefono = telefonoConCodigoPais(pedido.cliente_telefono);
  const totalFormateado = (pedido.total / 100).toFixed(2);
  const mensaje =
    `¡Hola ${pedido.cliente_nombre || ""}! Aquí está tu cotización de Buenos Prints ` +
    `(pedido ${pedido.numero}) por RD$${totalFormateado}.\n` +
    `${urlPdf}\n\n` +
    `${DATOS_TRANSFERENCIA}\n\n` +
    `¿Prefieres pagar con tarjeta? Avísame y te genero un link de pago por RD$${totalFormateado}.\n\n` +
    `Recuerda enviar el comprobante de pago por esta vía y/o al correo buenosprints.taller@gmail.com para confirmar la orden.\n\n` +
    `¡Gracias por confiar en nosotros!`;
  const base = telefono ? `https://wa.me/${telefono}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(mensaje)}`;
}

module.exports = { linkWhatsApp };
