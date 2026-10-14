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

async function enviarCotizacionAlTaller(pedido, pdfBuffer) {
  const transportador = crearTransportador();
  await transportador.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.TALLER_EMAIL || process.env.SMTP_USER,
    subject: `Nuevo pedido ${pedido.numero} — ${pedido.cliente_nombre || "cliente"}`,
    text: `Nuevo pedido recibido.\n\nNúmero: ${pedido.numero}\nCliente: ${pedido.cliente_nombre}\nTeléfono: ${pedido.cliente_telefono}\nTotal: RD$${(pedido.total / 100).toFixed(2)}\n\nAdjunto va el PDF con el detalle completo.`,
    attachments: [{ filename: `${pedido.numero}.pdf`, content: pdfBuffer }],
  });
}

module.exports = { enviarCotizacionAlTaller };
