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
    replyTo: process.env.TALLER_EMAIL || process.env.SMTP_USER,
    subject: plantilla.asunto(pedido),
    text: plantilla.cuerpo(pedido) + `\n\nSigue tu pedido en cualquier momento: ${urlRastreo(pedido)}`,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Correo de CONFIRMACIÓN al cliente (se envía apenas se crea el pedido).
// Así el cliente tiene su número de pedido y su cotización en el correo
// aunque cierre la pestaña antes de anotarlos. Independiente del WhatsApp
// con los datos de pago que el taller manda después.
// Estilo calcado del sitio: fondo crema, bordes negros gruesos, rojo
// #FF4D2E, número de pedido en "pastilla" amarilla, y los mismos pasos
// numerados de la página de rastreo. Todo con tablas y estilos en línea
// porque es lo único que respetan Gmail/Outlook.
// ---------------------------------------------------------------------------

const { PASOS, urlRastreo } = require("./rastreo");

const C = {
  bg: "#FFF8EC", paper: "#FFFFFF", ink: "#17140F", muted: "#6B6358", line: "#E8DFD0",
  accent: "#FF4D2E", sun: "#FFC93C", mint: "#2BB673",
};
const FUENTE = "'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const FUENTE_TITULO = "'Bricolage Grotesque','DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const WHATSAPP_TALLER = "18495779893";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function rd(centavos) {
  return `RD$${((centavos || 0) / 100).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Barra + círculos numerados (✓ en los completados), igual que el rastreo.
function pasosHTML(indiceActual) {
  const barras = PASOS.map((_, i) =>
    `<td style="padding:0 3px"><div style="height:5px;border-radius:999px;background:${i <= indiceActual ? C.ink : C.line};font-size:0;line-height:0">&nbsp;</div></td>`
  ).join("");
  const celdas = PASOS.map((p, i) => {
    const hecho = i < indiceActual;
    const actual = i === indiceActual;
    const fondo = hecho ? C.ink : actual ? C.accent : C.paper;
    const color = hecho || actual ? "#FFFFFF" : C.muted;
    const borde = hecho || actual ? C.ink : C.line;
    return `<td width="25%" align="center" valign="top" style="padding:12px 4px 0">
      <div style="width:30px;height:30px;line-height:30px;border-radius:50%;background:${fondo};color:${color};border:2px solid ${borde};font:700 14px ${FUENTE};text-align:center;margin:0 auto">${hecho ? "✓" : i + 1}</div>
      <div style="font:${actual ? 700 : 500} 12px/1.3 ${FUENTE};color:${actual ? C.ink : C.muted};margin-top:6px">${esc(p.titulo)}</div>
    </td>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${barras}</tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${celdas}</tr></table>`;
}

function boton(href, texto, { fondo = C.accent, color = "#FFFFFF" } = {}) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${fondo};color:${color};border:2px solid ${C.ink};border-radius:999px;padding:12px 22px;font:700 15px ${FUENTE};text-decoration:none;box-shadow:3px 3px 0 ${C.ink};margin:0 8px 10px 0">${texto}</a>`;
}

function resumenItemsHTML(detalle) {
  const items = Array.isArray(detalle.items) ? detalle.items : [];
  return items.map((it) => {
    const medida = it.w && it.h ? ` · ${it.w}" × ${it.h}"` : "";
    const extra = [it.material, it.forma].filter(Boolean).join(" · ");
    return `<tr>
      <td style="padding:10px 0;border-top:1px dashed ${C.line};font:15px/1.4 ${FUENTE};color:${C.ink}">
        <b>${esc(it.producto || "Producto")}</b><br>
        <span style="color:${C.muted};font-size:13px">${esc(Number(it.cantidad || 0).toLocaleString("es-DO"))} unds${esc(medida)}${extra ? " · " + esc(extra) : ""}</span>
      </td>
      <td align="right" valign="top" style="padding:10px 0;border-top:1px dashed ${C.line};font:700 15px ${FUENTE};color:${C.ink};white-space:nowrap">${rd(it.precioTotal)}</td>
    </tr>`;
  }).join("");
}

function htmlConfirmacion(pedido, linkRastreo) {
  let detalle = {};
  try { detalle = JSON.parse(pedido.detalle_json || "{}"); } catch (_) {}
  const nombre = (pedido.cliente_nombre || "").trim().split(/\s+/)[0];
  const linkWa = `https://wa.me/${WHATSAPP_TALLER}?text=${encodeURIComponent(`¡Hola! Tengo una pregunta sobre mi pedido ${pedido.numero}.`)}`;
  const rush = detalle.rush && typeof detalle.rush === "object" ? detalle.rush.costo : detalle.rush;

  const filasExtra = [
    detalle.descuento ? ["Descuento", `-${rd(detalle.descuento)}`] : null,
    rush ? ["Servicio RUSH (24h)", rd(rush)] : null,
    ["Entrega" + (detalle.entrega?.tipo ? ` · ${detalle.entrega.tipo}` : ""), detalle.envio ? rd(detalle.envio) : "Gratis"],
  ].filter(Boolean).map(([k, v]) =>
    `<tr><td style="padding:4px 0;font:14px ${FUENTE};color:${C.muted}">${esc(k)}</td><td align="right" style="padding:4px 0;font:14px ${FUENTE};color:${C.ink}">${esc(v)}</td></tr>`
  ).join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Pedido ${esc(pedido.numero)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden">Tu número de pedido es ${esc(pedido.numero)}. Te escribiremos por WhatsApp con los datos de pago.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

  <tr><td style="background:${C.accent};border:2px solid ${C.ink};border-radius:22px 22px 0 0;padding:18px 24px">
    <span style="font:800 24px ${FUENTE_TITULO};color:#FFFFFF;letter-spacing:-.02em">Buenos Prints</span>
  </td></tr>

  <tr><td style="background:${C.paper};border:2px solid ${C.ink};border-top:0;border-radius:0 0 22px 22px;padding:26px 24px">
    <h1 style="margin:0 0 6px;font:800 30px/1.05 ${FUENTE_TITULO};color:${C.ink};letter-spacing:-.02em">¡Pedido recibido${nombre ? ", " + esc(nombre) : ""}!</h1>
    <p style="margin:0 0 6px;font:16px/1.5 ${FUENTE};color:${C.ink}">Tu número de pedido es</p>
    <div style="display:inline-block;background:${C.sun};border:2px solid ${C.ink};border-radius:999px;padding:4px 16px;font:800 20px ${FUENTE};color:${C.ink};margin:0 0 22px">${esc(pedido.numero)}</div>

    ${pasosHTML(0)}

    <h2 style="margin:26px 0 8px;font:800 20px ${FUENTE_TITULO};color:${C.ink}">¿Qué sigue?</h2>
    <ol style="margin:0 0 20px;padding-left:20px;font:15px/1.55 ${FUENTE};color:${C.ink}">
      <li>Te escribimos por WhatsApp con los datos para completar el pago (transferencia o enlace con tarjeta).</li>
      <li>Con el pago confirmado, te enviamos la prueba digital en 24 horas o menos.</li>
      <li>Apruebas la prueba (ajustamos juntos cualquier detalle menor).</li>
      <li>Producimos en 2 a 3 días laborables y entregamos.</li>
    </ol>

    ${boton(linkRastreo, "Ver estado de mi pedido")}
    ${boton(linkWa, "Escribirnos por WhatsApp", { fondo: C.paper, color: C.ink })}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-collapse:collapse">
      <tr><td colspan="2" style="padding:0 0 4px;font:700 13px ${FUENTE};letter-spacing:.08em;text-transform:uppercase;color:${C.muted}">Tu pedido</td></tr>
      ${resumenItemsHTML(detalle)}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:2px solid ${C.ink};margin-top:6px;padding-top:6px">
      ${filasExtra}
      <tr><td style="padding:8px 0 0;font:800 18px ${FUENTE_TITULO};color:${C.ink}">Total</td><td align="right" style="padding:8px 0 0;font:800 18px ${FUENTE_TITULO};color:${C.ink}">${rd(pedido.total)}</td></tr>
    </table>

    <p style="margin:20px 0 0;font:13px/1.5 ${FUENTE};color:${C.muted}">Adjuntamos tu cotización en PDF. Para seguir tu pedido en cualquier momento entra a <a href="${esc(linkRastreo)}" style="color:${C.ink}">buenosprints.com/rastreo</a> con tu número de pedido y los últimos 4 dígitos de tu WhatsApp.</p>
  </td></tr>

  <tr><td align="center" style="padding:18px 8px;font:12px/1.5 ${FUENTE};color:${C.muted}">
    Buenos Prints · Stickers y etiquetas personalizadas · Santo Domingo, RD<br>WhatsApp 849-577-9893 · buenosprints.taller@gmail.com
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function textoConfirmacion(pedido, linkRastreo) {
  const nombre = (pedido.cliente_nombre || "").trim().split(/\s+/)[0];
  return [
    `¡Pedido recibido${nombre ? ", " + nombre : ""}!`,
    "",
    `Tu número de pedido es ${pedido.numero}. Total: ${rd(pedido.total)}.`,
    "",
    "¿Qué sigue?",
    "1. Te escribimos por WhatsApp con los datos para completar el pago (transferencia o enlace con tarjeta).",
    "2. Con el pago confirmado, te enviamos la prueba digital en 24 horas o menos.",
    "3. Apruebas la prueba (ajustamos juntos cualquier detalle menor).",
    "4. Producimos en 2 a 3 días laborables y entregamos.",
    "",
    `Sigue tu pedido: ${linkRastreo}`,
    "",
    "Adjuntamos tu cotización en PDF. ¿Dudas? Escríbenos por WhatsApp al 849-577-9893.",
    "",
    "— Buenos Prints",
  ].join("\n");
}

// No hace nada si el cliente no dejó correo. Lanza error si el SMTP falla
// (server.js lo atrapa: el pedido se crea igual).
async function enviarConfirmacionAlCliente(pedido, pdfBuffer) {
  if (!pedido.cliente_email) return { ok: false, motivo: "sin correo" };
  const linkRastreo = urlRastreo(pedido);
  const transportador = crearTransportador();
  await transportador.sendMail({
    from: { name: "Buenos Prints", address: process.env.SMTP_USER },
    to: pedido.cliente_email,
    replyTo: process.env.TALLER_EMAIL || process.env.SMTP_USER,
    subject: `Recibimos tu pedido ${pedido.numero} — Buenos Prints`,
    text: textoConfirmacion(pedido, linkRastreo),
    html: htmlConfirmacion(pedido, linkRastreo),
    attachments: pdfBuffer ? [{ filename: `Cotizacion-${pedido.numero}.pdf`, content: pdfBuffer }] : [],
  });
  return { ok: true };
}

module.exports = {
  enviarCotizacionAlTaller,
  enviarActualizacionAlCliente,
  enviarConfirmacionAlCliente,
  // expuestos para pruebas / vista previa
  htmlConfirmacion,
  pasosHTML,
};
