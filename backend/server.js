require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { crearPedido, obtenerPedido, marcarPagado, actualizarEstado, ESTADOS } = require("./lib/db");
const { generarPDFPedido } = require("./lib/pdf");
const { enviarCotizacionAlTaller, enviarActualizacionAlCliente } = require("./lib/email");
const { linkWhatsApp } = require("./lib/whatsapp");
const { registrarPedidoEnSheet } = require("./lib/sheets");

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" })); // el carrito puede traer imágenes en base64

const PORT = process.env.PORT || 3000;

// Crea un pedido nuevo: recibe el carrito ya armado desde el front-end.
// Devuelve el número interno, el PDF en base64 y el link de WhatsApp listo para enviar.
app.post("/api/pedidos", async (req, res) => {
  try {
    const { cliente, detalle, subtotal, total } = req.body;
    if (!detalle || typeof subtotal !== "number" || typeof total !== "number") {
      return res.status(400).json({ error: "Faltan datos del pedido (detalle, subtotal, total)." });
    }

    const pedido = await crearPedido({ cliente: cliente || {}, detalle, subtotal, total });
    const pdfBuffer = await generarPDFPedido(pedido, { esFactura: false });

    // El correo al taller es automático y no depende de nada más.
    let correoEnviado = true;
    try {
      await enviarCotizacionAlTaller(pedido, pdfBuffer);
    } catch (err) {
      correoEnviado = false;
      console.error("No se pudo enviar el correo al taller:", err.message);
    }

    // El registro en Sheets es best-effort: si no está configurado, simplemente se omite.
    registrarPedidoEnSheet(pedido).catch((err) => console.error("Sheets:", err.message));

    // El PDF se sirve desde esta misma API para el link de WhatsApp.
    const urlPdf = `${req.protocol}://${req.get("host")}/api/pedidos/${pedido.numero}/pdf`;

    res.json({
      numero: pedido.numero,
      total: pedido.total,
      correoEnviado,
      pdfBase64: pdfBuffer.toString("base64"),
      linkWhatsApp: linkWhatsApp(pedido, urlPdf),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno al crear el pedido." });
  }
});

// Sirve el PDF de un pedido ya creado (para el link que se manda por WhatsApp/correo).
app.get("/api/pedidos/:numero/pdf", async (req, res) => {
  const pedido = await obtenerPedido(req.params.numero);
  if (!pedido) return res.status(404).send("Pedido no encontrado");
  // Es "factura"/comprobante desde el momento en que el pedido quedó pagado
  // por primera vez (columna pagado_en), sin importar en qué estado esté
  // ahora (en producción, listo, entregado...) — así el dropdown de estados
  // puede crecer o cambiar de nombres sin romper esta lógica.
  const esFactura = Boolean(pedido.pagado_en);
  const pdfBuffer = await generarPDFPedido(pedido, { esFactura });
  res.set("Content-Type", "application/pdf");
  res.send(pdfBuffer);
});

// Marca un pedido como pagado (de momento, a mano desde el taller — ver README
// sobre cómo conectar esto a una pasarela de pago más adelante si se quiere).
app.post("/api/pedidos/:numero/pagar", async (req, res) => {
  const pedido = await marcarPagado(req.params.numero);
  if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
  res.json({ ok: true, pedido });
});

// Llamado por el Apps Script del Google Sheet cuando alguien en el taller
// cambia el dropdown "Estado" de un pedido. Protegido con un secreto
// compartido (SHEETS_WEBHOOK_SECRET) para que no cualquiera en internet
// pueda cambiar estados o disparar correos a clientes.
app.post("/api/pedidos/:numero/estado", async (req, res) => {
  const secreto = process.env.SHEETS_WEBHOOK_SECRET;
  if (!secreto) {
    return res.status(500).json({ error: "SHEETS_WEBHOOK_SECRET no configurado en el servidor." });
  }
  if (req.get("x-webhook-secret") !== secreto) {
    return res.status(401).json({ error: "No autorizado." });
  }

  const { estado } = req.body || {};
  if (!ESTADOS.includes(estado)) {
    return res.status(400).json({ error: `Estado inválido. Debe ser uno de: ${ESTADOS.join(", ")}` });
  }

  try {
    const pedido = await actualizarEstado(req.params.numero, estado);
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });

    let correoEnviado = false;
    try {
      const resultado = await enviarActualizacionAlCliente(pedido, estado);
      correoEnviado = Boolean(resultado?.ok);
    } catch (err) {
      console.error("No se pudo enviar el correo de actualización de estado:", err.message);
    }

    res.json({ ok: true, pedido, correoEnviado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno al actualizar el estado." });
  }
});

// TEMPORAL — diagnóstico de solo lectura, para confirmar si el Apps Script
// ya logró cambiar el estado de un pedido. Se quita apenas se use.
app.get("/api/admin/ver-bf1d1496027e5104471a644f/:numero", async (req, res) => {
  const pedido = await obtenerPedido(req.params.numero);
  if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
  res.json({ numero: pedido.numero, estado: pedido.estado, pagado_en: pedido.pagado_en });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Buenos Prints backend escuchando en :${PORT}`));
