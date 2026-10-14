// Registro automático de cada pedido en Google Sheets (el "CRM" gratuito).
//
// A partir de esta versión, "Pedidos" ya NO es una sola pestaña continua:
// cada pedido se escribe en la pestaña de SU MES, con nombre
// "Pedidos YYYY-MM" (ej. "Pedidos 2026-10"), para que la hoja "Resumen"
// pueda sacar totales por mes y del año con fórmulas simples y sin que la
// pestaña de pedidos se vuelva interminable. Si la pestaña del mes no
// existe todavía (ej. el primer pedido de un mes nuevo), se crea sola
// duplicando la plantilla oculta "_Plantilla" (que ya trae el dropdown de
// estado con colores y los encabezados/formato correctos).
//
// También calcula y escribe, por pedido, las columnas financieras que
// pidió el taller: Venta bruta, ITBIS 18%, Venta neta, Costo de producción
// (a RD$35 por pie cuadrado, según las medidas reales de cada artículo) y
// Utilidad/Margen bruto. Se escriben como VALORES (no fórmulas) en el
// momento del pedido, para que cada fila sea autosuficiente y no dependa de
// fórmulas frágiles entre pestañas.
//
// Requiere una cuenta de servicio de Google Cloud con acceso de Editor a la
// hoja, y el ID de esa hoja (GOOGLE_SERVICE_ACCOUNT_JSON y GOOGLE_SHEET_ID).
// Si no están configuradas, esta función simplemente no hace nada — no
// rompe el flujo de pedidos.
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
// `w`/`h` de cada item son en PULGADAS (igual que en lib/pdf.js, que imprime
// `Medida: ${w}" x ${h}".`).

const { google } = require("googleapis");

const HOJA_DETALLE = "Detalle de productos";
const PLANTILLA_PEDIDOS = "_Plantilla";
const BASE_URL = process.env.BASE_URL || "https://api.buenosprints.com";

// RD$ por pie cuadrado de material (costo de producción, solo materia
// prima — no incluye mano de obra, tinta, desgaste de equipo, etc.).
const COSTO_POR_PIE_CUADRADO = 35;
const PULG2_POR_PIE2 = 144;

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

const pesos = (centavos) => Math.round(((centavos || 0) / 100) * 100) / 100;

// Nombre de la pestaña del mes para una fecha dada, ej. "Pedidos 2026-10".
function nombreHojaMes(fecha) {
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  return `Pedidos ${yyyy}-${mm}`;
}

// Devuelve el sheetId de `nombre` si ya existe, o null si no.
async function buscarHoja(sheets, spreadsheetId, nombre) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });
  const encontrada = (meta.data.sheets || []).find((s) => s.properties.title === nombre);
  return encontrada ? encontrada.properties.sheetId : null;
}

// Crea la pestaña del mes duplicando "_Plantilla" (que ya tiene el dropdown
// de estado, los colores condicionales y los encabezados listos), la
// renombra, la des-oculta y la deja visible al final del libro.
async function crearHojaDelMes(sheets, spreadsheetId, nombre) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const todas = meta.data.sheets || [];
  const plantilla = todas.find((s) => s.properties.title === PLANTILLA_PEDIDOS);
  if (!plantilla) {
    throw new Error(`No se encontró la pestaña plantilla "${PLANTILLA_PEDIDOS}" para crear "${nombre}".`);
  }

  const resp = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          duplicateSheet: {
            sourceSheetId: plantilla.properties.sheetId,
            insertSheetIndex: todas.length,
            newSheetName: nombre,
          },
        },
      ],
    },
  });
  const nuevaId = resp.data.replies[0].duplicateSheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ updateSheetProperties: { properties: { sheetId: nuevaId, hidden: false }, fields: "hidden" } }],
    },
  });

  return nuevaId;
}

async function asegurarHojaDelMes(sheets, spreadsheetId, nombre) {
  const existente = await buscarHoja(sheets, spreadsheetId, nombre);
  if (existente != null) return existente;
  return crearHojaDelMes(sheets, spreadsheetId, nombre);
}

// Costo de producción de un pedido: suma, por artículo, el área en pies
// cuadrados (ancho x alto en pulgadas / 144) por la cantidad, a RD$35/pie².
// Si un artículo no trae medidas (w/h), simplemente no aporta costo — mejor
// subestimar que inventar un número.
function calcularCostoProduccion(items) {
  return items.reduce((total, it) => {
    const w = Number(it.w) || 0;
    const h = Number(it.h) || 0;
    const cantidad = Number(it.cantidad) || 0;
    if (!w || !h || !cantidad) return total;
    const piesCuadrados = (w * h) / PULG2_POR_PIE2;
    return total + piesCuadrados * cantidad * COSTO_POR_PIE_CUADRADO;
  }, 0);
}

async function registrarPedidoEnSheet(pedido) {
  if (!habilitado()) return { ok: false, motivo: "no configurado" };

  const sheets = clienteSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const detalle = JSON.parse(pedido.detalle_json || "{}");
  const items = detalle.items || [];
  const fecha = new Date(pedido.creado_en);
  const hojaPedidos = nombreHojaMes(fecha);
  await asegurarHojaDelMes(sheets, spreadsheetId, hojaPedidos);

  const resumenProductos = items
    .map((it) => `${it.producto || "Producto"} x${it.cantidad ?? ""}`)
    .join("; ");
  const unidadesTotales = items.reduce((a, it) => a + (Number(it.cantidad) || 0), 0);

  // --- Matemática fiscal y de costos ---
  // Los precios en todo el sitio ya incluyen el 18% de ITBIS (ver
  // desgloseFiscal() en el front-end), y pedido.total ya suma items +
  // RUSH + envío y resta el descuento/cupón. Por eso el ITBIS y la venta
  // neta se extraen del TOTAL, no del subtotal.
  const ventaBruta = pesos(pedido.total);
  const itbis = Math.round((ventaBruta * 18) / 118 * 100) / 100;
  const ventaNeta = Math.round((ventaBruta - itbis) * 100) / 100;
  const costoProduccion = Math.round(calcularCostoProduccion(items) * 100) / 100;
  const utilidadBruta = Math.round((ventaNeta - costoProduccion) * 100) / 100;
  const margenBruto = ventaNeta > 0 ? Math.round((utilidadBruta / ventaNeta) * 10000) / 10000 : "";

  const filaPedido = [
    pedido.numero,
    fecha, // Fecha
    fecha.toLocaleTimeString("es-DO", { hour: "2-digit", minute: "2-digit" }), // Hora
    ESTADO_ETIQUETA[pedido.estado] || pedido.estado,
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
    ventaBruta,
    itbis,
    ventaNeta,
    costoProduccion,
    utilidadBruta,
    margenBruto,
    detalle.entrega?.tipo || "",
    detalle.entrega?.direccion || "",
    detalle.fechaDeseada || "",
    detalle.notas || "",
    detalle.cupon?.codigo || "",
    `${BASE_URL}/api/pedidos/${pedido.numero}/pdf`,
    pedido.ecf_numero || "",
    pedido.pagado_en ? new Date(pedido.pagado_en) : "",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${hojaPedidos}'!A:AC`,
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
      spreadsheetId,
      range: `${HOJA_DETALLE}!A:J`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: filasDetalle },
    });
  }

  return { ok: true, hoja: hojaPedidos };
}

// Etiquetas en español que ve quien toma las órdenes en el taller (el
// dropdown de la hoja usa exactamente estos textos). Deben coincidir con
// los `ESTADOS` de lib/db.js y con la plantilla/Apps Script.
const ESTADO_ETIQUETA = {
  cotizado: "Cotizado",
  pagado_produccion: "Pagado - En producción",
  listo_entrega: "Listo para entrega",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

module.exports = { registrarPedidoEnSheet, habilitado, ESTADO_ETIQUETA };
