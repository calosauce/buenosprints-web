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
async function enviarCotizacionAlTaller(pedido, pdfBuffer, linkWhatsApp, archivosAdjuntos = [], avisosExtra = []) {
  const transportador = crearTransportador();
  await transportador.sendMail({
    from: { name: "Buenos Prints — Pedidos", address: process.env.SMTP_USER },
    to: process.env.TALLER_EMAIL || process.env.SMTP_USER,
    // Responder este correo le escribe directo al cliente (si dejó correo).
    replyTo: pedido.cliente_email || undefined,
    subject: asuntoTaller(pedido),
    text: textoTaller(pedido, linkWhatsApp, archivosAdjuntos.length, avisosExtra),
    html: htmlTaller(pedido, linkWhatsApp, archivosAdjuntos.length, avisosExtra),
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

function resumenHTML(pedido, detalle, etiqueta = "Tu pedido") {
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
      <tr><td colspan="2" style="padding:0 0 4px;font:700 13px ${FUENTE};letter-spacing:.08em;text-transform:uppercase;color:${C.muted}">${etiqueta}</td></tr>
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
function textoTaller(p, linkWa, nArchivos, avisosExtra = []) {
  const d = leerDetalle(p);
  const items = Array.isArray(d.items) ? d.items : [];
  const avisos = [...avisosExtra, ...avisosTaller(p, d)].map((a) => "• " + a.replace(/<[^>]+>/g, ""));
  return [
    `Nuevo pedido ${p.numero}`, "",
    ...(avisos.length ? ["ATENCIÓN:", ...avisos, ""] : []),
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
// Asunto pensado para decidir desde la bandeja sin abrir el correo:
// "⚡ RUSH · BP-2026-000722 · RD$4,707.00 · María Pérez" (la etiqueta RUSH
// solo cuando aplica).
function asuntoTaller(p) {
  const rush = leerDetalle(p).rush ? "⚡ RUSH · " : "";
  return `${rush}${p.numero} · ${rd(p.total)} · ${p.cliente_nombre || "Cliente"}`;
}

// Días desde hoy (hora de Santo Domingo, UTC-4 todo el año) hasta una fecha
// "AAAA-MM-DD". null si no hay fecha o no se entiende.
function diasHasta(fechaISO) {
  const m = String(fechaISO || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const ahoraRD = new Date(Date.now() - 4 * 3600 * 1000);
  const hoy = Date.UTC(ahoraRD.getUTCFullYear(), ahoraRD.getUTCMonth(), ahoraRD.getUTCDate());
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - hoy) / 86400000);
}

// Avisos que necesitan atención. Solo aparecen cuando aplican; si no hay
// ninguno, el correo no muestra el recuadro.
function avisosTaller(p, d) {
  const items = Array.isArray(d.items) ? d.items : [];
  const avisos = [];
  if (d.rush) avisos.push("<b>RUSH:</b> entrega en 24 horas luego de aprobar la prueba.");
  const dias = diasHasta(d.fechaDeseada);
  if (dias !== null && dias <= 3) {
    const cuando = dias < 0 ? "ya pasó" : dias === 0 ? "es hoy" : dias === 1 ? "es mañana" : `es en ${dias} días`;
    avisos.push(`<b>Fecha deseada cercana:</b> ${esc(d.fechaDeseada)} (${cuando}).`);
  }
  const sinDiseno = items.map((it, i) => (!it.enlace && !it.nombreArchivo ? i + 1 : null)).filter(Boolean);
  if (sinDiseno.length) avisos.push(`<b>Sin diseño:</b> ${sinDiseno.length === 1 ? "el diseño" : "los diseños"} ${sinDiseno.join(", ")} no ${sinDiseno.length === 1 ? "trae" : "traen"} archivo ni enlace.`);
  if (!p.cliente_email) avisos.push("<b>Sin correo:</b> el cliente no recibe confirmación ni avisos por correo — todo va por WhatsApp.");
  return avisos;
}

function htmlTaller(p, linkWa, nArchivos, avisosExtra = []) {
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

  const avisos = [...avisosExtra, ...avisosTaller(p, d)];
  const cuerpo = `
    ${avisos.length ? `<div style="background:#FFF4D1;border:2px solid ${C.ink};border-radius:14px;padding:10px 14px;margin:0 0 18px;font:14.5px/1.5 ${FUENTE};color:${C.ink}">${avisos.map((a) => `<div style="padding:2px 0">${a}</div>`).join("")}</div>` : ""}

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
      ${filaDato("Cupón", d.cupon && d.cupon.codigo ? esc(d.cupon.codigo) : "")}
    </table>

    <h2 style="margin:22px 0 6px;font:800 20px ${FUENTE_TITULO};color:${C.ink}">Diseños</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${disenos}</table>
    ${d.notas ? `<div style="background:${C.bg};border:2px solid ${C.ink};border-radius:14px;padding:10px 14px;margin:12px 0 0;font:14px/1.5 ${FUENTE};color:${C.ink}"><b>Notas del pedido:</b> ${esc(d.notas)}</div>` : ""}

    ${resumenHTML(p, d, "Resumen")}

    <p style="margin:20px 0 0;font:13px/1.5 ${FUENTE};color:${C.muted}">Adjuntos: la cotización en PDF${nArchivos ? ` y ${nArchivos} archivo(s) de diseño que subió el cliente` : ""}.</p>

    <div style="border-top:2px solid ${C.ink};margin:22px 0 0;padding:18px 0 0">
    <p style="margin:0 0 12px;font:700 15px/1.5 ${FUENTE};color:${C.ink}">¿Todo revisado (diseños, entrega y total)? Envía la cotización al cliente:</p>
    ${linkWa ? `<a href="${esc(linkWa)}" style="display:inline-block;background:#25D366;color:#FFFFFF;border:2px solid ${C.ink};border-radius:999px;padding:14px 24px;font:700 16px ${FUENTE};text-decoration:none;box-shadow:3px 3px 0 ${C.ink}">Abrir WhatsApp con el cliente</a>
    <p style="margin:10px 0 0;font:13px/1.5 ${FUENTE};color:${C.muted}">Mensaje con la cotización y los datos de pago ya escrito — solo falta revisar y presionar enviar.</p>` : ""}
    </div>`;

  return marcoHTML({
    simple: true,
    preheader: `${p.cliente_nombre || "Cliente"} · ${rd(p.total)} · ${items.length} diseño(s)${avisos.length ? " · revisar avisos" : ""}`,
    tituloPagina: `Nuevo pedido ${p.numero}`,
    contenido: `<h1 style="margin:0 0 4px;font:800 24px/1.1 ${FUENTE_TITULO};color:${C.ink};letter-spacing:-.02em">Nuevo pedido</h1>
    <p style="margin:0 0 6px;font:16px/1.5 ${FUENTE};color:${C.ink}">de <b>${esc(p.cliente_nombre || "cliente")}</b> por <b>${rd(p.total)}</b></p>
    <div style="display:inline-block;background:${C.sun};border:2px solid ${C.ink};border-radius:999px;padding:4px 16px;font:800 20px ${FUENTE};color:${C.ink};margin:0 0 20px">${esc(p.numero)}</div><br>
    ${cuerpo}`,
  });
}

// Header rojo con el logo + tarjeta blanca + pie. Compartido por todos.
function marcoHTML({ preheader, tituloPagina, contenido, simple = false }) {
  // simple (correo interno del taller): sin header, logo, fondo crema ni
  // marco; todo pegado al margen izquierdo sobre blanco, para leerlo rápido
  // en la PC del taller y copiar/pegar datos sin arrastrar diseño.
  if (simple) {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(tituloPagina)}</title></head>
<body style="margin:0;padding:0;background:#FFFFFF">
<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>
<div style="max-width:640px;padding:16px 12px;text-align:left">
${contenido}
</div>
</body></html>`;
  }
  const padCab = "16px 22px", anchoLogo = 200;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(tituloPagina)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

  <tr><td align="center" style="background:${C.accent};border:2px solid ${C.ink};border-radius:22px 22px 0 0;padding:${padCab};text-align:center">
    <a href="https://buenosprints.com" style="text-decoration:none;display:inline-block"><img src="${URL_LOGO}" width="${anchoLogo}" height="${Math.round(anchoLogo / 4)}" alt="Buenos Prints" style="display:block;margin:0 auto;border:0;width:${anchoLogo}px;height:auto;max-width:100%;font:800 24px ${FUENTE_TITULO};color:#FFFFFF"></a>
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

function plantillaHTML(pedido, { preheader, titulo, intro, pasoActual, aviso, cuerpo, nota, comprobante }) {
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

    ${comprobante ? `<div style="background:#E3F6EC;border:2px solid ${C.ink};border-radius:14px;padding:12px 16px;margin:0 0 20px;font:15px/1.5 ${FUENTE};color:${C.ink}"><b>Adjuntamos tu comprobante de pago</b> en PDF, con el detalle de tu pedido y la fecha del pago. Guárdalo para tus registros.</div>` : ""}

    ${boton(linkRastreo, "Ver estado de mi pedido")}
    ${boton(linkWhatsAppTaller(pedido), "Escribirnos por WhatsApp", { fondo: C.paper, color: C.ink })}

    ${resumenHTML(pedido, detalle)}

    <p style="margin:20px 0 0;font:13px/1.5 ${FUENTE};color:${C.muted}">${nota || ""}Para seguir tu pedido en cualquier momento entra a <a href="${esc(linkRastreo)}" style="color:${C.ink}">buenosprints.com/rastreo</a> con tu número de pedido y los últimos 4 dígitos de tu WhatsApp.</p>`,
  });
}

// "AAAA-MM-DD" → "15 de noviembre de 2026"
function fechaLarga(iso) {
  const [a, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString("es-DO", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
}
function urlUsarCupon(codigo) {
  return `${process.env.SITIO_URL || "https://buenosprints.com"}/?cupon=${encodeURIComponent(codigo)}#pedido`;
}
// Pergamino de descuento en estilo 8 bits (diseño propio): los rodillos y
// las esquinas son imágenes pixel art (email/pergamino-arriba.png y
// -abajo.png, generadas píxel por píxel, 4 px por píxel), y el cuerpo es una
// tabla con bordes negros gruesos que calzan con esas imágenes. El código va
// como TEXTO para que se pueda copiar. Solo tablas y colores sólidos.
function pergaminoHTML(cupon) {
  const base = process.env.SITIO_URL || "https://buenosprints.com";
  const papel = "#F6E7C1", tinta = C.ink, cafe = "#5E3A17", oro = "#9A5B0B", morado = "#5B2E91";
  const PIXEL = "'Courier New',Courier,monospace";
  const tapa = (img) => `<tr><td style="padding:0;font-size:0;line-height:0"><img src="${base}/email/${img}" width="400" alt="" style="display:block;width:100%;height:auto;border:0"></td></tr>`;
  const fila = (k, v) => `<tr><td style="padding:3px 0;font:15px/1.45 ${FUENTE};color:${cafe}"><span style="font:700 14px ${PIXEL};color:${oro}">&#9656; ${k}:</span> ${v}</td></tr>`;
  const boton8 = `<a href="${esc(urlUsarCupon(cupon.codigo))}" style="display:inline-block;background:${C.accent};color:#FFFFFF;border:4px solid ${tinta};padding:12px 16px;font:700 15px ${PIXEL};letter-spacing:.02em;white-space:nowrap;text-transform:uppercase;text-decoration:none;box-shadow:4px 4px 0 ${tinta}">&#9654; Usar mi pergamino</a>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:400px">
    ${tapa("pergamino-arriba.png")}
    <tr><td style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed"><tr>
      <td width="3%" style="width:3%;font-size:0;line-height:0">&nbsp;</td>
      <td width="1%" style="width:1%;background:${tinta};font-size:0;line-height:0">&nbsp;</td>
      <td width="92%" style="width:92%;background:${papel}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 14px 12px">
          <div style="font:700 12px ${PIXEL};letter-spacing:.12em;text-transform:uppercase;color:${morado};text-align:center">&#9733; Objeto único &#9733;</div>
          <div style="font:700 13px ${PIXEL};color:${morado};text-align:center;margin:2px 0 0">Solo para ti</div>
          <div style="font:900 25px/1.15 ${PIXEL};text-transform:uppercase;color:${tinta};text-align:center;margin:10px 0 12px;letter-spacing:.02em">Pergamino de<br>descuento ${cupon.porcentaje}%</div>
          <div style="border-top:4px dashed ${tinta};margin:0 0 10px;font-size:0;line-height:0">&nbsp;</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${fila("Efecto", `<b style="color:${tinta}">−${cupon.porcentaje}%</b> en tu próximo pedido de stickers o etiquetas`)}
            ${fila("Tasa de éxito", `<b style="color:${tinta}">100%</b>`)}
            ${fila("Usos", `<b style="color:${tinta}">1</b>`)}
            ${fila("Vence", `<b style="color:${tinta}">${esc(fechaLarga(cupon.expira))}</b>`)}
          </table>
          <div style="margin:14px 0 6px;text-align:center;font:700 13px ${PIXEL};color:${cafe};text-transform:uppercase;letter-spacing:.08em">Tu código</div>
          <div style="text-align:center"><span style="display:inline-block;background:#FFFFFF;border:4px solid ${tinta};padding:8px 14px;font:900 21px ${PIXEL};letter-spacing:.06em;white-space:nowrap;color:${tinta}">${esc(cupon.codigo)}</span></div>
          <div style="text-align:center;margin:18px 0 12px">${boton8}</div>
          <div style="text-align:center;font:12px/1.4 ${FUENTE};color:${cafe}">Aplica sobre los productos (no envío ni RUSH). Un cupón por pedido.</div>
        </td></tr>
      </table>
      </td>
      <td width="1%" style="width:1%;background:${tinta};font-size:0;line-height:0">&nbsp;</td>
      <td width="3%" style="width:3%;font-size:0;line-height:0">&nbsp;</td>
    </tr></table></td></tr>
    ${tapa("pergamino-abajo.png")}
  </table>
</td></tr></table>`;
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
    html: (p, x = {}) => plantillaHTML(p, {
      comprobante: Boolean(x.comprobante),
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
    html: (p, x = {}) => {
      const tipo = leerDetalle(p).entrega?.tipo;
      return plantillaHTML(p, {
        comprobante: Boolean(x.comprobante),
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
    asunto: (p, x = {}) => x.cupon
      ? `Pedido ${p.numero} entregado — y un regalo para tu próxima aventura`
      : `Pedido ${p.numero} — Entregado`,
    html: (p, x = {}) => plantillaHTML(p, {
      comprobante: Boolean(x.comprobante),
      preheader: x.cupon
        ? `Misión cumplida: tu pedido llegó. Te dejamos un pergamino de ${x.cupon.porcentaje}% para la próxima.`
        : `Tu pedido ${p.numero} fue entregado. ¡Gracias por preferirnos!`,
      titulo: `¡Llegamos a la cima${primerNombre(p) ? ", " + esc(primerNombre(p)) : ""}!`,
      intro: "Tu pedido fue entregado",
      pasoActual: 3,
      cuerpo:
        h2("Misión cumplida") +
        parrafo("Toda gran aventura empieza con un paso pequeño: el tuyo fue subir un diseño. De ahí en adelante fue puro camino: la mesa de corte, el laminado, el troquel siguiendo cada curva… y una última subida hasta llegar a tus manos.") +
        parrafo(x.cupon
          ? "Pero las mejores historias no se acaban en el primer capítulo. Para tu próxima aventura, te dejamos esto en el camino:"
          : "Pero las mejores historias no se acaban en el primer capítulo. Cuando quieras empezar la próxima, aquí estamos.") +
        (x.cupon ? pergaminoHTML(x.cupon) : "") +
        parrafo("¿Ya los pegaste? Nos encantaría verlos: etiquétanos en Instagram <a href=\"https://instagram.com/buenos.prints\" style=\"color:" + C.ink + "\">@buenos.prints</a>."),
    }),
    texto: (p, x = {}) => [
      `¡Llegamos a la cima${primerNombre(p) ? ", " + primerNombre(p) : ""}!`, "",
      `Tu pedido ${p.numero} fue entregado. Toda gran aventura empieza con un paso pequeño: el tuyo fue subir un diseño. Después vino el camino —la mesa de corte, el laminado, el troquel— hasta llegar a tus manos.`, "",
      "Pero las mejores historias no se acaban en el primer capítulo.",
      ...(x.cupon ? [
        "", `🎁 PERGAMINO DE DESCUENTO ${x.cupon.porcentaje}%`,
        `Código: ${x.cupon.codigo}`,
        `Efecto: ${x.cupon.porcentaje}% de descuento en tu próximo pedido (sobre los productos; no aplica a envío ni RUSH).`,
        `Usos: 1 · Vence: ${fechaLarga(x.cupon.expira)}`,
        `Úsalo aquí: ${urlUsarCupon(x.cupon.codigo)}`,
      ] : []),
      "", "¿Ya los pegaste? Etiquétanos en Instagram: @buenos.prints",
    ].join("\n"),
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

// Recordatorio: el pergamino vence pronto. No va con la plantilla de pedido
// (sin pasos ni resumen): es un correo corto centrado en el pergamino.
function htmlRecordatorio(p, cupon, dias) {
  const cuando = dias <= 0 ? "vence hoy" : dias === 1 ? "vence mañana" : `vence en ${dias} días`;
  return marcoHTML({
    preheader: `Tu pergamino de ${cupon.porcentaje}% ${cuando}. Úsalo en tu próximo pedido.`,
    tituloPagina: "Tu pergamino vence pronto",
    contenido: `<h1 style="margin:0 0 6px;font:800 30px/1.05 ${FUENTE_TITULO};color:${C.ink};letter-spacing:-.02em">Tu pergamino ${cuando}${primerNombre(p) ? ", " + esc(primerNombre(p)) : ""}</h1>
    <p style="margin:0 0 18px;font:16px/1.5 ${FUENTE};color:${C.ink}">Lo encontraste al final de tu última aventura con nosotros (pedido ${esc(p.numero)}) y todavía sigue en tu inventario. Los pergaminos no duran para siempre: úsalo antes del <b>${esc(fechaLarga(cupon.expira))}</b>.</p>
    ${pergaminoHTML(cupon)}
    <p style="margin:0;font:14px/1.5 ${FUENTE};color:${C.muted}">¿Ideas para la próxima? Etiquetas para tus productos, stickers para regalar o una hoja de stickers para tu marca. Si tienes dudas, escríbenos por <a href="${esc(linkWhatsAppTaller(p))}" style="color:${C.ink}">WhatsApp</a>.</p>`,
  });
}
async function enviarRecordatorioCupon(pedido, cupon, dias) {
  if (!pedido.cliente_email) return { ok: false, motivo: "sin correo" };
  const cuando = dias <= 0 ? "vence hoy" : dias === 1 ? "vence mañana" : `vence en ${dias} días`;
  const transportador = crearTransportador();
  await transportador.sendMail({
    from: { name: "Buenos Prints", address: process.env.SMTP_USER },
    to: pedido.cliente_email,
    replyTo: process.env.TALLER_EMAIL || process.env.SMTP_USER,
    subject: `Tu pergamino de ${cupon.porcentaje}% ${cuando}`,
    text: [
      `Hola${primerNombre(pedido) ? " " + primerNombre(pedido) : ""},`, "",
      `Tu pergamino de descuento de ${cupon.porcentaje}% ${cuando} (${fechaLarga(cupon.expira)}).`,
      `Código: ${cupon.codigo} · Úsalo aquí: ${urlUsarCupon(cupon.codigo)}`, "",
      "Aplica sobre los productos (no envío ni RUSH). Un cupón por pedido.", "", "— Buenos Prints",
    ].join("\n"),
    html: htmlRecordatorio(pedido, cupon, dias),
  });
  return { ok: true };
}

async function enviarCorreoCliente(pedido, clave, attachments = [], extra = {}) {
  const correo = CORREOS[clave];
  if (!correo || !pedido.cliente_email) return { ok: false, motivo: "sin plantilla o sin correo" };
  const transportador = crearTransportador();
  await transportador.sendMail({
    from: { name: "Buenos Prints", address: process.env.SMTP_USER },
    to: pedido.cliente_email,
    replyTo: process.env.TALLER_EMAIL || process.env.SMTP_USER,
    subject: correo.asunto(pedido, extra),
    text: `${correo.texto(pedido, extra)}${extra.comprobante ? "\n\nAdjuntamos tu comprobante de pago en PDF." : ""}\n\nSigue tu pedido: ${urlRastreo(pedido)}\n\n— Buenos Prints`,
    html: correo.html(pedido, extra),
    attachments: extra.comprobante
      ? [...attachments, { filename: `Comprobante-${pedido.numero}.pdf`, content: extra.comprobante }]
      : attachments,
  });
  return { ok: true };
}

// Copia del comprobante para el TALLER (archivo fiscal), en el formato sobrio
// del taller. Se envía siempre la primera vez que el pedido queda pagado,
// también cuando el cliente no tiene correo (para reenviárselo por WhatsApp).
async function enviarComprobanteAlTaller(pedido, pdfBuffer, { clienteNotificado }) {
  const d = leerDetalle(pedido);
  const fechaPago = pedido.pagado_en ? new Date(pedido.pagado_en).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo", day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  const estadoCliente = clienteNotificado
    ? `Enviado al cliente (${esc(pedido.cliente_email)}).`
    : `<b style="color:${C.accent}">El cliente no tiene correo:</b> reenvíale este PDF por WhatsApp.`;
  const html = marcoHTML({
    simple: true,
    preheader: `${pedido.cliente_nombre || "Cliente"} · ${rd(pedido.total)} · pagado ${fechaPago}`,
    tituloPagina: `Comprobante ${pedido.numero}`,
    contenido: `<h1 style="margin:0 0 4px;font:800 24px/1.1 ${FUENTE_TITULO};color:${C.ink}">Comprobante de pago</h1>
    <p style="margin:0 0 6px;font:16px/1.5 ${FUENTE};color:${C.ink}">${esc(pedido.cliente_nombre || "Cliente")} · <b>${rd(pedido.total)}</b></p>
    <div style="display:inline-block;background:${C.sun};border:2px solid ${C.ink};border-radius:999px;padding:4px 16px;font:800 20px ${FUENTE};color:${C.ink};margin:0 0 16px">${esc(pedido.numero)}</div>
    <p style="margin:0 0 14px;font:15px/1.5 ${FUENTE};color:${C.ink}">${estadoCliente}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      ${filaDato("Fecha de pago", esc(fechaPago))}
      ${filaDato("Total pagado", `<b>${rd(pedido.total)}</b>`)}
      ${filaDato("Razón social", esc(pedido.cliente_razon_social || ""))}
      ${filaDato("RNC/Cédula", esc(pedido.cliente_rnc || ""))}
      ${filaDato("Cupón", d.cupon && d.cupon.codigo ? esc(d.cupon.codigo) : "")}
      ${filaDato("e-CF", esc(pedido.ecf_numero || ""))}
    </table>
    <p style="margin:16px 0 0;font:13px/1.5 ${FUENTE};color:${C.muted}">Adjunto: el comprobante en PDF, para el archivo del taller.</p>`,
  });
  const transportador = crearTransportador();
  await transportador.sendMail({
    from: { name: "Buenos Prints — Pedidos", address: process.env.SMTP_USER },
    to: process.env.TALLER_EMAIL || process.env.SMTP_USER,
    subject: `Comprobante ${pedido.numero} · ${rd(pedido.total)} · ${pedido.cliente_nombre || "Cliente"}`,
    text: [
      `Comprobante de pago ${pedido.numero}`, "",
      `Cliente: ${pedido.cliente_nombre || "-"}`,
      pedido.cliente_razon_social ? `Razón social: ${pedido.cliente_razon_social}` : null,
      pedido.cliente_rnc ? `RNC/Cédula: ${pedido.cliente_rnc}` : null,
      `Fecha de pago: ${fechaPago}`, `Total pagado: ${rd(pedido.total)}`, "",
      clienteNotificado ? `Enviado al cliente (${pedido.cliente_email}).` : "El cliente no tiene correo: reenvíale este PDF por WhatsApp.",
    ].filter((x) => x !== null).join("\n"),
    html,
    attachments: [{ filename: `Comprobante-${pedido.numero}.pdf`, content: pdfBuffer }],
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
// `extra.cupon`: cupón de fidelidad (solo al pasar a "entregado").
function enviarActualizacionAlCliente(pedido, estado, extra = {}) {
  if (estado === "confirmacion") return Promise.resolve({ ok: false, motivo: "estado inválido" });
  return enviarCorreoCliente(pedido, estado, [], extra);
}

module.exports = {
  enviarCotizacionAlTaller,
  enviarActualizacionAlCliente,
  enviarConfirmacionAlCliente,
  // expuestos para pruebas / vista previa
  enviarRecordatorioCupon,
  htmlRecordatorio,
  enviarComprobanteAlTaller,
  CORREOS,
  pasosHTML,
  htmlTaller,
  asuntoTaller,
};
