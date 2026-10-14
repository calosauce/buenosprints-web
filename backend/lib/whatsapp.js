// Genera el link de WhatsApp (click-to-chat) con el mensaje y el pedido ya listos.
// No envía nada automáticamente: el taller recibe el link por correo (o en la
// respuesta de la API) y con un toque abre el chat del cliente en su WhatsApp
// Business normal, con el mensaje pre-escrito. Cuando se quiera automatizar el
// 100% del envío, este archivo es el que se reemplaza por una llamada a la
// Cloud API de Meta (o un proveedor como Twilio/360dialog) — el resto del
// backend no cambia.

function linkWhatsApp(pedido, urlPdf) {
  const telefono = (pedido.cliente_telefono || "").replace(/[^\d]/g, "");
  const mensaje =
    `¡Hola ${pedido.cliente_nombre || ""}! Aquí está tu cotización de Buenos Prints ` +
    `(pedido ${pedido.numero}) por RD$${(pedido.total / 100).toFixed(2)}.\n` +
    `${urlPdf}\n` +
    `Para confirmar, realiza el pago y contesta este mensaje.`;
  const base = telefono ? `https://wa.me/${telefono}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(mensaje)}`;
}

module.exports = { linkWhatsApp };
