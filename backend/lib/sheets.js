// Registro automático de cada pedido en Google Sheets (el "CRM" gratuito).
// Escribe dos pestañas del libro "Buenos Prints - CRM de Pedidos.xlsx":
//   - "Pedidos"            → una fila resumen por pedido.
//   - "Detalle de productos" → una fila por artículo dentro del pedido
//     (para poder ver más adelante qué productos/materiales se venden más).
//
// Requiere una cuenta de servicio de Google Cloud con acceso de Editor a la
// hoja, y el ID de esa hoja (GOOGLE_SERVICE_ACCOUNT_JSON y GOOGLE_SHEET_ID).
// Si no están configuradas, esta función simplemente no hace nada — no rompe
// el flujo de pedidos — así se puede activar en cualquier momento sin tocar
// el resto del backend.
//
// Forma esperada de `pedido.detalle_json` (lo que guarda lib/db.js, tal como
// lo arma el front-end al enviar el carrito):
//   {
//     items: [{ producto, material, forma, w, h, cantidad, precioTotal }],
//     entrega: { tipo, direccion },
//     fechaDeseada, notas,
//     cupon: { codigo, descuento } | null,
//     rush: { horas, costo } | null,
//     envio, // centavos
//   }

const { google } = require("googleapis");

const HOJA_PEDIDOS = "Pedidos";
const HOJA_DETALLE = "Detalle de productos";
const BASE_URL = process.env.BASE_URL || "https://api.buenosprints.com";

function habilitado() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_SHEET_ID);
}

function clienteSheets() {
  const credenciales = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: credenciales,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

const pesos = (centavos) => Math.round((centavos || 0) / 100 * 100) / 100;

async function registrarPedidoEnSheet(pedido) {
  if (!habilitado()) return { ok: false, motivo: "no configurado" };

  const sheets = clienteSheets();
  const detalle = JSON.parse(pedido.detalle_json || "{}");
  const items = detalle.items || [];
  const fecha = new Date(pedido.creado_en);
  const mes = fecha.toISOString().slice(0, 7); // YYYY-MM, igual al TEXT(...,"YYYY-MM") de la hoja "Resumen"

  const resumenProductos = items
    .map((it) => `${it.producto || "Producto"} x${it.cantidad ?? ""}`)
    .join("; ");
  const unidadesTotales = items.reduce((a, it) => a + (Number(it.cantidad) || 0), 0);

  const filaPedido = [
    pedido.numero,
    fecha, // Fecha
    fecha.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" }), // Hora
    pedido.estado,
    pedido.cliente_nombre || "",
    pedido.cliente_razon_social || "",
    pedido.cliente_rnc || "",
    pedido.cliente_telefono || "",
    pedido.cliente_email || "",
    resumenProductos,
    unidadesTotales,
    pesos(pedido.subtotal),
    pesos(detalle.cupon?.descuento ? detalle.cupon.descuento : detalle.descuento),
    pesos(detalle.rush?.costo),
    pesos(detalle.envio),
    pesos(pedido.total),
    detalle.entrega?.tipo || "",
    detalle.entrega?.direccion || "",
    detalle.fechaDeseada || "",
    detalle.notas || "",
    detalle.cupon?.codigo || "",
    `${BASE_URL}/api/pedidos/${pedido.numero}/pdf`,
    pedido.ecf_numero || "",
    pedido.pagado_en ? new Date(pedido.pagado_en) : "",
    mes,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${HOJA_PEDIDOS}!A:Y`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [filaPedido] },
  });

  if (items.length) {
    const filasDetalle = items.map((it) => [
      pedido.numero,
      fecha,
      it.producto || "",
      it.material || "",
      it.forma || "",
      it.w || "",
      it.h || "",
      it.cantidad || "",
      pesos(it.precioUnit != null ? it.precioUnit * 100 : (it.precioTotal || 0) / (it.cantidad || 1)),
      pesos(it.precioTotal),
    ]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${HOJA_DETALLE}!A:J`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: filasDetalle },
    });
  }

  return { ok: true };
}

module.exports = { registrarPedidoEnSheet, habilitado };
