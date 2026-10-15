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
  await transportador.sendMail({
    from: { name: "Buenos Prints — Pedidos", address: process.env.SMTP_USER },
    to: process.env.TALLER_EMAIL || process.env.SMTP_USER,
    // Responder este correo le escribe directo al cliente (si dejó correo).
    replyTo: pedido.cliente_email || undefined,
    subject: `Nuevo pedido ${pedido.numero} — ${pedido.cliente_nombre || "cliente"}`,
    text: textoTaller(pedido, linkWhatsApp, archivosAdjuntos.length),
    html: htmlTaller(pedido, linkWhatsApp, archivosAdjuntos.length),
    attachments: [{ filename: `${pedido.numero}.pdf`, content: pdfBuffer }, ...archivosAdjuntos],
  });
}

// ---------------------------------------------------------------------------
// Correos al CLIENTE: confirmación (al crear el pedido) y actualizaciones
// de estado (cuando el taller cambia el dropdown "Estado" del Sheet).
// Todos usan la misma plantilla, calcada del sitio: header rojo con el logo,
// tarjeta blanca con borde negro grueso, número de pedido en pastilla
// amarilla, los mismos pasos numerados de la página de rastreo, y el resumen
// del pedido. Todo con tablas y estilos en línea porque es lo único que
// respetan Gmail/Outlook. El logo es un PNG (email/logo.png en la raíz del
// sitio) porque Gmail/Outlook no muestran SVG.
// ---------------------------------------------------------------------------

const { PASOS, urlRastreo } = require("./rastreo");

const C = {
  bg: "#FFF8EC", paper: "#FFFFFF", ink: "#17140F", muted: "#6B6358", line: "#E8DFD0",
  accent: "#FF4D2E", sun: "#FFC93C", mint: "#2BB673", badBg: "#FFE1D9",
};
const FUENTE = "'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const FUENTE_TITULO = "'Bricolage Grotesque','DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const WHATSAPP_TALLER = "18495779893";
const URL_LOGO = `${process.env.SITIO_URL || "https://buenosprints.com"}/email/logo.png`;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function rd(centavos) {
  return `RD$${((centavos || 0) / 100).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function primerNombre(pedido) {
  return (pedido.cliente_nombre || "").trim().split(/\s+/)[0] || "";
}

function leerDetalle(pedido) {
  try { return JSON.parse(pedido.detalle_json || "{}"); } catch (_) { return {}; }
}

function linkWhatsAppTaller(pedido) {
  return `https://wa.me/${WHATSAPP_TALLER}?text=${encodeURIComponent(`¡Hola! Tengo una pregunta sobre mi pedido ${pedido.numero}.`)}`;
}

// Barra + círculos numerados, igual que el rastreo: ✓ negro en los pasos
// hechos, rojo en el actual y, cuando el pedido ya se entregó (último paso),
// todo completo con el último en verde.
function pasosHTML(indiceActual) {
  const ultimo = PASOS.length - 1;
  const barras = PASOS.map((_, i) =>
    `<td style="padding:0 3px"><div style="height:5px;border-radius:999px;background:${i <= indiceActual ? C.ink : C.line};font-size:0;line-height:0">&nbsp;</div></td>`
  ).join("");
  const celdas = PASOS.map((p, i) => {
    const final = i === indiceActual && i === ultimo;
    const hecho = i < indiceActual;
    const actual = i === indiceActual && !final;
    const fondo = final ? C.mint : hecho ? C.ink : actual ? C.accent : C.paper;
    const activo = hecho || actual || final;
    const color = activo ? "#FFFFFF" : C.muted;
    const borde = activo ? C.ink : C.line;
    return `<td width="25%" align="center" valign="top" style="padding:12px 4px 0">
      <div style="width:30px;height:30px;line-height:30px;border-radius:50%;background:${fondo};color:${color};border:2px solid ${borde};font:700 14px ${FUENTE};text-align:center;margin:0 auto">${hecho || final ? "✓" : i + 1}</div>
      <div style="font:${actual || final ? 700 : 500} 12px/1.3 ${FUENTE};color:${actual || final ? C.ink : C.muted};margin-top:6px">${esc(p.titulo)}</div>
    </td>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${barras}</tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${celdas}</tr></table>`;
}

function boton(href, texto, { fondo = C.accent, color = "#FFFFFF" } = {}) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${fondo};color:${color};border:2px solid ${C.ink};border-radius:999px;padding:12px 22px;font:700 15px ${FUENTE};text-decoration:none;box-shadow:3px 3px 0 ${C.ink};margin:0 8px 10px 0">${texto}</a>`;
}

function resumenHTML(pedido, detalle) {
  const items = Array.isArray(detalle.items) ? detalle.items : [];
  const filasItems = items.map((it) => {
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

  const rush = detalle.rush && typeof detalle.rush === "object" ? detalle.rush.costo : detalle.rush;
  const filasExtra = [
    detalle.descuento ? ["Descuento", `-${rd(detalle.descuento)}`] : null,
    rush ? ["Servicio RUSH (24h)", rd(rush)] : null,
    ["Entrega" + (detalle.entrega?.tipo ? ` · ${detalle.entrega.tipo}` : ""), detalle.envio ? rd(detalle.envio) : "Gratis"],
  ].filter(Boolean).map(([k, v]) =>
    `<tr><td style="padding:4px 0;font:14px ${FUENTE};color:${C.muted}">${esc(k)}</td><td align="right" style="padding:4px 0;font:14px ${FUENTE};color:${C.ink}">${esc(v)}</td></tr>`
  ).join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-collapse:collapse">
      <tr><td colspan="2" style="padding:0 0 4px;font:700 13px ${FUENTE};letter-spacing:.08em;text-transform:uppercase;color:${C.muted}">Tu pedido</td></tr>
      ${filasItems}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:2px solid ${C.ink};margin-top:6px">
      ${filasExtra}
      <tr><td style="padding:8px 0 0;font:800 18px ${FUENTE_TITULO};color:${C.ink}">Total</td><td align="right" style="padding:8px 0 0;font:800 18px ${FUENTE_TITULO};color:${C.ink}">${rd(pedido.total)}</td></tr>
    </table>`;
}

// Plantilla común. `pasoActual` = índice 0-3, o null para no mostrar pasos
// (cancelado). `aviso` = recuadro rojo opcional (cancelado).
// Correo INTERNO para el taller: mismo diseño que los del cliente, pero
// pensado para trabajar el pedido: botón de WhatsApp arriba, todos los datos
// de contacto y entrega, los enlaces/notas de cada diseño y el resumen.
function filaDato(k, v) {
  if (!v) return "";
  return `<tr><td valign="top" style="padding:6px 12px 6px 0;font:14px ${FUENTE};color:${C.muted};white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;font:15px/1.4 ${FUENTE};color:${C.ink}">${v}</td></tr>`;
}
function textoTaller(p, linkWa, nArchivos) {
  const d = leerDetalle(p);
  const items = Array.isArray(d.items) ? d.items : [];
  return [
    `Nuevo pedido ${p.numero}`, "",
    `Cliente: ${p.cliente_nombre || "-"}`,
    p.cliente_razon_social ? `Razón social: ${p.cliente_razon_social}` : null,
    p.cliente_rnc ? `RNC: ${p.cliente_rnc}` : null,
    `WhatsApp: ${p.cliente_telefono || "-"}`,
    `Correo: ${p.cliente_email || "-"}`,
    `Entrega: ${d.entrega?.tipo || "-"}${d.entrega?.direccion ? " — " + d.entrega.direccion : ""}`,
    d.fechaDeseada ? `Fecha deseada: ${d.fechaDeseada}` : null,
    d.rush ? "RUSH: sí (24h)" : null,
    "", "Diseños:",
    ...items.map((it, i) => `${i + 1}. ${it.producto || "Producto"} · ${it.cantidad || 0} unds${it.w && it.h ? ` · ${it.w}" × ${it.h}"` : ""}${it.material ? " · " + it.material : ""}${it.forma ? " · " + it.forma : ""}` +
      (it.enlace ? `\n   Enlace: ${it.enlace}` : it.nombreArchivo ? `\n   Archivo adjunto: ${it.nombreArchivo}` : "") + (it.notas ? `\n   Notas: ${it.notas}` : "")),
    d.notas ? `\nNotas del pedido: ${d.notas}` : null,
    "", `Total: ${rd(p.total)}`,
    `Adjuntos: PDF de cotización${nArchivos ? ` + ${nArchivos} archivo(s) de diseño` : ""}.`,
    linkWa ? `\nAbrir WhatsApp con el cliente (mensaje y datos de pago ya listos):\n${linkWa}` : null,
  ].filter((x) => x !== null).join("\n");
}
function htmlTaller(p, linkWa, nArchivos) {
  const d = leerDetalle(p);
  const items = Array.isArray(d.items) ? d.items : [];
  const tel = p.cliente_telefono ? `<a href="tel:${esc(String(p.cliente_telefono).replace(/[^\d+]/g, ""))}" style="color:${C.ink}">${esc(p.cliente_telefono)}</a>` : "";
  const correo = p.cliente_email ? `<a href="mailto:${esc(p.cliente_email)}" style="color:${C.ink}">${esc(p.cliente_email)}</a>` : "<span style=\"color:" + C.muted + "\">(no dejó correo)</span>";
  const entrega = d.entrega?.tipo ? esc(d.entrega.tipo) + (d.entrega.direccion ? `<br><span style="color:${C.muted}">${esc(d.entrega.direccion)}</span>` : "") : "";
  const disenos = items.map((it, i) => {
    const medida = it.w && it.h ? ` · ${it.w}" × ${it.h}"` : "";
    const extra = [it.material, it.forma].filter(Boolean).join(" · ");
    const archivo = it.enlace
      ? `<a href="${esc(it.enlace)}" style="color:${C.ink};font-weight:700">Abrir enlace del diseño</a>`
      : it.nombreArchivo ? `Archivo adjunto: <b>${esc(it.nombreArchivo)}</b>` : `<span style="color:${C.accent};font-weight:700">Sin diseño todavía</span>`;
    return `<tr><td style="padding:10px 0;border-top:1px dashed ${C.line};font:15px/1.45 ${FUENTE};color:${C.ink}">
      <b>${i + 1}. ${esc(it.producto || "Producto")}</b> <span style="color:${C.muted}">— ${esc(Number(it.cantidad || 0).toLocaleString("es-DO"))} unds${esc(medida)}${extra ? " · " + esc(extra) : ""}</span><br>
      ${archivo}${it.notas ? `<br><span style="color:${C.muted}">Notas:</span> ${esc(it.notas)}` : ""}
    </td></tr>`;
  }).join("");

  const cuerpo = `
    ${linkWa ? `<a href="${esc(linkWa)}" style="display:inline-block;background:#25D366;color:#FFFFFF;border:2px solid ${C.ink};border-radius:999px;padding:14px 24px;font:700 16px ${FUENTE};text-decoration:none;box-shadow:3px 3px 0 ${C.ink}">Abrir WhatsApp con el cliente</a>
    <p style="margin:10px 0 0;font:13px/1.5 ${FUENTE};color:${C.muted}">Mensaje con la cotización y los datos de pago ya escrito — solo falta revisar y presionar enviar.</p>` : ""}

    <h2 style="margin:26px 0 6px;font:800 20px ${FUENTE_TITULO};color:${C.ink}">Cliente</h2>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      ${filaDato("Nombre", esc(p.cliente_nombre || "-"))}
      ${filaDato("Razón social", esc(p.cliente_razon_social || ""))}
      ${filaDato("RNC", esc(p.cliente_rnc || ""))}
      ${filaDato("WhatsApp", tel)}
      ${filaDato("Correo", correo)}
      ${filaDato("Entrega", entrega)}
      ${filaDato("Fecha deseada", esc(d.fechaDeseada || ""))}
      ${filaDato("RUSH", d.rush ? `<b style="color:${C.accent}">Sí — entrega en 24h</b>` : "")}
    </table>

    <h2 style="margin:22px 0 6px;font:800 20px ${FUENTE_TITULO};color:${C.ink}">Diseños</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${disenos}</table>
    ${d.notas ? `<div style="background:${C.bg};border:2px solid ${C.ink};border-radius:14px;padding:10px 14px;margin:12px 0 0;font:14px/1.5 ${FUENTE};color:${C.ink}"><b>Notas del pedido:</b> ${esc(d.notas)}</div>` : ""}

    ${resumenHTML(p, d)}

    <p style="margin:20px 0 0;font:13px/1.5 ${FUENTE};color:${C.muted}">Adjuntos: la cotización en PDF${nArchivos ? ` y ${nArchivos} archivo(s) de diseño que subió el cliente` : ""}.</p>`;

  return marcoHTML({
    preheader: `${p.cliente_nombre || "Cliente"} · ${rd(p.total)} · ${items.length} diseño(s)`,
    tituloPagina: `Nuevo pedido ${p.numero}`,
    contenido: `<h1 style="margin:0 0 6px;font:800 30px/1.05 ${FUENTE_TITULO};color:${C.ink};letter-spacing:-.02em">Nuevo pedido</h1>
    <p style="margin:0 0 6px;font:16px/1.5 ${FUENTE};color:${C.ink}">de <b>${esc(p.cliente_nombre || "cliente")}</b> por <b>${rd(p.total)}</b></p>
    <div style="display:inline-block;background:${C.sun};border:2px solid ${C.ink};border-radius:999px;padding:4px 16px;font:800 20px ${FUENTE};color:${C.ink};margin:0 0 20px">${esc(p.numero)}</div><br>
    ${cuerpo}`,
  });
}

// Header rojo con el logo + tarjeta blanca + pie. Compartido por todos.
function marcoHTML({ preheader, tituloPagina, contenido }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(tituloPagina)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

  <tr><td align="center" style="background:${C.accent};border:2px solid ${C.ink};border-radius:22px 22px 0 0;padding:16px 22px;text-align:center">
    <a href="https://buenosprints.com" style="text-decoration:none;display:inline-block"><img src="${URL_LOGO}" width="200" height="50" alt="Buenos Prints" style="display:block;margin:0 auto;border:0;width:200px;height:auto;max-width:100%;font:800 24px ${FUENTE_TITULO};color:#FFFFFF"></a>
  </td></tr>

  <tr><td style="background:${C.paper};border:2px solid ${C.ink};border-top:0;border-radius:0 0 22px 22px;padding:26px 24px">
    ${contenido}
  </td></tr>

  <tr><td align="center" style="padding:18px 8px;font:12px/1.5 ${FUENTE};color:${C.muted}">
    Buenos Prints · Stickers y etiquetas personalizadas · Santo Domingo, RD<br>WhatsApp 849-577-9893 · buenosprints.taller@gmail.com
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function plantillaHTML(pedido, { preheader, titulo, intro, pasoActual, aviso, cuerpo, nota }) {
  const linkRastreo = urlRastreo(pedido);
  const detalle = leerDetalle(pedido);
  return marcoHTML({
    preheader,
    tituloPagina: `Pedido ${pedido.numero}`,
    contenido: `<h1 style="margin:0 0 6px;font:800 30px/1.05 ${FUENTE_TITULO};color:${C.ink};letter-spacing:-.02em">${titulo}</h1>
    <p style="margin:0 0 6px;font:16px/1.5 ${FUENTE};color:${C.ink}">${intro}</p>
    <div style="display:inline-block;background:${C.sun};border:2px solid ${C.ink};border-radius:999px;padding:4px 16px;font:800 20px ${FUENTE};color:${C.ink};margin:0 0 22px">${esc(pedido.numero)}</div>

    ${aviso ? `<div style="background:${C.badBg};border:2px solid ${C.ink};border-radius:14px;padding:12px 16px;margin:0 0 18px;font:15px/1.5 ${FUENTE};color:${C.ink}">${aviso}</div>` : ""}
    ${pasoActual === null || pasoActual === undefined ? "" : pasosHTML(pasoActual)}

    ${cuerpo}

    ${boton(linkRastreo, "Ver estado de mi pedido")}
    ${boton(linkWhatsAppTaller(pedido), "Escribirnos por WhatsApp", { fondo: C.paper, color: C.ink })}

    ${resumenHTML(pedido, detalle)}

    <p style="margin:20px 0 0;font:13px/1.5 ${FUENTE};color:${C.muted}">${nota || ""}Para seguir tu pedido en cualquier momento entra a <a href="${esc(linkRastreo)}" style="color:${C.ink}">buenosprints.com/rastreo</a> con tu número de pedido y los últimos 4 dígitos de tu WhatsApp.</p>`,
  });
}

const h2 = (t) => `<h2 style="margin:26px 0 8px;font:800 20px ${FUENTE_TITULO};color:${C.ink}">${t}</h2>`;
const parrafo = (t) => `<p style="margin:0 0 20px;font:15px/1.55 ${FUENTE};color:${C.ink}">${t}</p>`;
const lista = (items) => `<ol style="margin:0 0 20px;padding-left:20px;font:15px/1.55 ${FUENTE};color:${C.ink}">${items.map((t) => `<li>${t}</li>`).join("")}</ol>`;

// Contenido de cada correo. `html` arma el correo con la plantilla común;
// `texto` es la versión sin formato (para clientes de correo sin HTML).
const CORREOS = {
  confirmacion: {
    asunto: (p) => `Recibimos tu pedido ${p.numero} — Buenos Prints`,
    html: (p) => plantillaHTML(p, {
      preheader: `Tu número de pedido es ${p.numero}. Te escribiremos por WhatsApp con los datos de pago.`,
      titulo: `¡Pedido recibido${primerNombre(p) ? ", " + esc(primerNombre(p)) : ""}!`,
      intro: "Tu número de pedido es",
      pasoActual: 0,
      cuerpo: h2("¿Qué sigue?") + lista([
        "Te escribimos por WhatsApp con los datos para completar el pago (transferencia o enlace con tarjeta).",
        "Con el pago confirmado, te enviamos la prueba digital en 24 horas o menos.",
        "Apruebas la prueba (ajustamos juntos cualquier detalle menor).",
        "Producimos en 2 a 3 días laborables y entregamos.",
      ]),
      nota: "Adjuntamos tu cotización en PDF. ",
    }),
    texto: (p) => [
      `¡Pedido recibido${primerNombre(p) ? ", " + primerNombre(p) : ""}!`, "",
      `Tu número de pedido es ${p.numero}. Total: ${rd(p.total)}.`, "",
      "¿Qué sigue?",
      "1. Te escribimos por WhatsApp con los datos para completar el pago (transferencia o enlace con tarjeta).",
      "2. Con el pago confirmado, te enviamos la prueba digital en 24 horas o menos.",
      "3. Apruebas la prueba (ajustamos juntos cualquier detalle menor).",
      "4. Producimos en 2 a 3 días laborables y entregamos.", "",
      "Adjuntamos tu cotización en PDF. ¿Dudas? Escríbenos por WhatsApp al 849-577-9893.",
    ].join("\n"),
  },

  pagado_produccion: {
    asunto: (p) => `Pedido ${p.numero} — ¡Pago confirmado, en producción!`,
    html: (p) => plantillaHTML(p, {
      preheader: `Confirmamos tu pago. Tu pedido ${p.numero} ya está en producción.`,
      titulo: `¡Pago confirmado${primerNombre(p) ? ", " + esc(primerNombre(p)) : ""}!`,
      intro: "Tu pedido ya está en producción",
      pasoActual: 1,
      cuerpo: h2("¿Qué sigue?") + lista([
        "Te enviamos la prueba digital por WhatsApp en 24 horas o menos.",
        "Apruebas la prueba (ajustamos juntos cualquier detalle menor).",
        "Producimos en 2 a 3 días laborables y te avisamos por aquí cuando esté listo.",
      ]),
    }),
    texto: (p) => `Hola${primerNombre(p) ? " " + primerNombre(p) : ""},\n\nConfirmamos el pago de tu pedido ${p.numero} y ya está en producción.\n\nTe enviamos la prueba digital por WhatsApp en 24 horas o menos y te avisamos por aquí cuando esté listo.\n\n¡Gracias por tu compra!`,
  },

  listo_entrega: {
    asunto: (p) => `Pedido ${p.numero} — ¡Listo para entrega!`,
    html: (p) => {
      const tipo = leerDetalle(p).entrega?.tipo;
      return plantillaHTML(p, {
        preheader: `Tu pedido ${p.numero} está listo. Coordinemos la entrega.`,
        titulo: `¡Tu pedido está listo${primerNombre(p) ? ", " + esc(primerNombre(p)) : ""}!`,
        intro: "Ya terminamos tu pedido",
        pasoActual: 2,
        cuerpo: h2("Coordinemos la entrega") + parrafo(
          (tipo ? `Elegiste <b>${esc(tipo)}</b>. ` : "") +
          "Escríbenos por WhatsApp al 849-577-9893 para coordinar el día y la hora de entrega o retiro."
        ),
      });
    },
    texto: (p) => `Hola${primerNombre(p) ? " " + primerNombre(p) : ""},\n\n¡Tu pedido ${p.numero} ya está listo! Coordina la entrega o retiro con nosotros por WhatsApp (849-577-9893).\n\n¡Gracias por tu compra!`,
  },

  entregado: {
    asunto: (p) => `Pedido ${p.numero} — Entregado`,
    html: (p) => plantillaHTML(p, {
      preheader: `Tu pedido ${p.numero} fue entregado. ¡Gracias por preferirnos!`,
      titulo: `¡Pedido entregado${primerNombre(p) ? ", " + esc(primerNombre(p)) : ""}!`,
      intro: "Esperamos que te encante",
      pasoActual: 3,
      cuerpo: h2("¡Gracias por preferirnos!") + parrafo(
        "Si tienes cualquier duda con tu pedido, o quieres hacer otro, escríbenos por WhatsApp. " +
        "Y si publicas tus stickers, etiquétanos en Instagram: <a href=\"https://instagram.com/buenos.prints\" style=\"color:" + C.ink + "\">@buenos.prints</a>."
      ),
    }),
    texto: (p) => `Hola${primerNombre(p) ? " " + primerNombre(p) : ""},\n\nConfirmamos que tu pedido ${p.numero} fue entregado. ¡Esperamos que te encante!\n\nSi tienes cualquier duda o quieres hacer otro pedido, aquí estamos.\n\n¡Gracias por preferirnos!`,
  },

  cancelado: {
    asunto: (p) => `Pedido ${p.numero} — Cancelado`,
    html: (p) => plantillaHTML(p, {
      preheader: `Tu pedido ${p.numero} fue cancelado.`,
      titulo: "Pedido cancelado",
      intro: "Cancelamos tu pedido",
      pasoActual: null,
      aviso: "<b>Este pedido fue cancelado.</b> Si crees que es un error o quieres volver a hacerlo, escríbenos por WhatsApp al 849-577-9893.",
      cuerpo: "",
    }),
    texto: (p) => `Hola${primerNombre(p) ? " " + primerNombre(p) : ""},\n\nTu pedido ${p.numero} fue cancelado. Si crees que esto es un error o quieres volver a hacer el pedido, escríbenos por WhatsApp (849-577-9893).\n\nGracias por tu comprensión.`,
  },
};

async function enviarCorreoCliente(pedido, clave, attachments = []) {
  const correo = CORREOS[clave];
  if (!correo || !pedido.cliente_email) return { ok: false, motivo: "sin plantilla o sin correo" };
  const transportador = crearTransportador();
  await transportador.sendMail({
    from: { name: "Buenos Prints", address: process.env.SMTP_USER },
    to: pedido.cliente_email,
    replyTo: process.env.TALLER_EMAIL || process.env.SMTP_USER,
    subject: correo.asunto(pedido),
    text: `${correo.texto(pedido)}\n\nSigue tu pedido: ${urlRastreo(pedido)}\n\n— Buenos Prints`,
    html: correo.html(pedido),
    attachments,
  });
  return { ok: true };
}

// Confirmación al crear el pedido (con la cotización en PDF adjunta).
// Lanza error si el SMTP falla (server.js lo atrapa: el pedido se crea igual).
function enviarConfirmacionAlCliente(pedido, pdfBuffer) {
  const adjuntos = pdfBuffer ? [{ filename: `Cotizacion-${pedido.numero}.pdf`, content: pdfBuffer }] : [];
  return enviarCorreoCliente(pedido, "confirmacion", adjuntos);
}

// Actualización cuando el taller cambia el Estado en el Sheet. "cotizado" no
// tiene correo (es el estado inicial: el cliente ya recibió la confirmación).
function enviarActualizacionAlCliente(pedido, estado) {
  if (estado === "confirmacion") return Promise.resolve({ ok: false, motivo: "estado inválido" });
  return enviarCorreoCliente(pedido, estado);
}

module.exports = {
  enviarCotizacionAlTaller,
  enviarActualizacionAlCliente,
  enviarConfirmacionAlCliente,
  // expuestos para pruebas / vista previa
  CORREOS,
  pasosHTML,
  htmlTaller,
};
