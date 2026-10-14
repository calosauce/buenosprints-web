// Registro del pedido como fila en Google Sheets (el "CRM" gratuito).
// Requiere una cuenta de servicio de Google Cloud con acceso de Editor a la
// hoja, y el ID de esa hoja. Si no está configurado, esta función no hace
// nada (no rompe el flujo de pedidos) — así se puede activar después sin tocar
// el resto del backend.

const { google } = require("googleapis");

function habilitado() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_SHEET_ID);
}

async function registrarPedidoEnSheet(pedido) {
  if (!habilitado()) return { ok: false, motivo: "no configurado" };

  const credenciales = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: credenciales,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Pedidos!A:H",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        pedido.numero,
        new Date(pedido.creado_en).toLocaleString("es-DO"),
        pedido.cliente_nombre || "",
        pedido.cliente_telefono || "",
        pedido.cliente_email || "",
        (pedido.total / 100).toFixed(2),
        pedido.estado,
        "",
      ]],
    },
  });
  return { ok: true };
}

module.exports = { registrarPedidoEnSheet, habilitado };
