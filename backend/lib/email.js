// Envío de correo automático al taller con el PDF adjunto.
// Credenciales SMTP via variables de entorno — nunca hardcodeadas ni commiteadas.
// Usa el buzón del propio dominio (ej. pedidos@buenosprints.com) una vez creado en Hostinger.

const nodemailer = require("nodemailer");

function crearTransportador() {
  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,       // ej. smtp.gmail.com, smtp.hostinger.com
    port,
    // Puerto 465 = TLS implícito (secure: true). Puerto 587 (y cualquier otro
    // que no sea 465, como el STARTTLS de Gmail) = TLS negociado después de
    // conectar (secure: false). Fijar esto en `true` siempre rompe el envío
    // por 587 (ej. Gmail) con un error de autenticación/conexión confuso.
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,     // ej. pedidos@buenosprints.com
      pass: process.env.SMTP_PASS,
    },
  });
}

// `linkWhatsApp` es el link "click-to-chat" (wa.me/<teléfono del cliente>)
// con el mensaje de cotización + datos de pago ya escritos — ver
// backend/lib/whatsapp.js. Quien reciba este correo y lo abra en un
// dispositivo con sesión de WhatsApp (Business normal o la versión web) ve
// la conversación con el cliente ya armada, lista para revisar y presionar
// enviar — no se manda nada automáticamente.
// `archivosAdjuntos` son los diseños que el cliente subió directo (no por
// enlace de Drive/WeTransfer) — ver server.js, que los separa del resto del
// pedido antes de guardarlo. Formato nodemailer: [{ filename, content }].
async function enviarCotizacionAlTaller(pedido, pdfBuffer, linkWhatsApp, archivosAdjuntos = []) {
  const transportador = crearTransportador();
  const telefono = pedido.cliente_telefono || "(sin teléfono)";
  const whatsappTexto = linkWhatsApp
    ? `\n\nAbrir WhatsApp con el cliente (mensaje y datos de pago ya listos, solo falta enviar):\n${linkWhatsApp}`
    : "";
  const archivosTexto = archivosAdjuntos.length
    ? `\n\nSe adjuntan ${archivosAdjuntos.length} archivo(s) de diseño que subió el cliente.`
    : "";
  await transportador.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.TALLER_EMAIL || process.env.SMTP_USER,
    subject: `Nuevo pedido ${pedido.numero} — ${pedido.cliente_nombre || "cliente"}`,
    text:
      `Nuevo pedido recibido.\n\nNúmero: ${pedido.numero}\nCliente: ${pedido.cliente_nombre}\nTeléfono: ${telefono}\nTotal: RD$${(pedido.total / 100).toFixed(2)}\n\nAdjunto va el PDF con el detalle completo.` +
      archivosTexto +
      whatsappTexto,
    html: linkWhatsApp
      ? `<p>Nuevo pedido recibido.</p>
         <p><b>Número:</b> ${pedido.numero}<br>
         <b>Cliente:</b> ${pedido.cliente_nombre || ""}<br>
         <b>Teléfono:</b> ${telefono}<br>
         <b>Total:</b> RD$${(pedido.total / 100).toFixed(2)}</p>
         <p>Adjunto va el PDF con el detalle completo.</p>
         <p><a href="${linkWhatsApp}" style="background:#25D366;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Abrir WhatsApp con el cliente</a><br>
         <span style="color:#666;font-size:13px">Mensaje y datos de pago ya listos — solo falta revisar y presionar enviar.</span></p>`
      : undefined,
    attachments: [{ filename: `${pedido.numero}.pdf`, content: pdfBuffer }, ...archivosAdjuntos],
  });
}

// Mensajes amigables por estado para el correo que recibe el CLIENTE cuando
// alguien en el taller cambia el dropdown "Estado" en Google Sheets.
// "cotizado" no dispara correo (es el estado inicial, el cliente ya recibió
// la cotización por correo/WhatsApp al hacer el pedido).
const MENSAJES_ESTADO = {
  pagado_produccion: {
    asunto: (p) => `Pedido ${p.numero} — ¡Pago confirmado, en producción!`,
    cuerpo: (p) => `Hola${p.cliente_nombre ? " " + p.cliente_nombre : ""},\n\nConfirmamos el pago de tu pedido ${p.numero} y ya está en producción en el taller.\n\nTe avisaremos por aquí en cuanto esté listo para entrega.\n\n¡Gracias por tu compra!`,
  },
  listo_entrega: {
    asunto: (p) => `Pedido ${p.numero} — ¡Listo para entrega!`,
    cuerpo: (p) => `Hola${p.cliente_nombre ? " " + p.cliente_nombre : ""},\n\n¡Tu pedido ${p.numero} ya está listo! Puedes coordinar la entrega o retiro con nosotros por WhatsApp (849-577-9893).\n\n¡Gracias por tu compra!`,
  },
  entregado: {
    asunto: (p) => `Pedido ${p.numero} — Entregado`,
    cuerpo: (p) => `Hola${p.cliente_nombre ? " " + p.cliente_nombre : ""},\n\nConfirmamos que tu pedido ${p.numero} fue entregado. ¡Esperamos que te encante!\n\nSi tienes cualquier duda o quieres hacer otro pedido, aquí estamos.\n\n¡Gracias por preferirnos!`,
  },
  cancelado: {
    asunto: (p) => `Pedido ${p.numero} — Cancelado`,
    cuerpo: (p) => `Hola${p.cliente_nombre ? " " + p.cliente_nombre : ""},\n\nTu pedido ${p.numero} fue cancelado. Si crees que esto es un error o quieres volver a hacer el pedido, escríbenos por WhatsApp (849-577-9893).\n\nGracias por tu comprensión.`,
  },
};

// Envía al CLIENTE (no al taller) un correo con el nuevo estado de su pedido.
// No hace nada si el estado no tiene mensaje definido (ej. "cotizado") o si
// el pedido no tiene correo de contacto.
async function enviarActualizacionAlCliente(pedido, estado) {
  const plantilla = MENSAJES_ESTADO[estado];
  if (!plantilla || !pedido.cliente_email) return { ok: false, motivo: "sin plantilla o sin correo" };

  const transportador = crearTransportador();
  await transportador.sendMail({
    from: process.env.SMTP_USER,
    to: pedido.cliente_email,
    subject: plantilla.asunto(pedido),
    text: plantilla.cuerpo(pedido),
  });
  return { ok: true };
}

module.exports = { enviarCotizacionAlTaller, enviarActualizacionAlCliente };
