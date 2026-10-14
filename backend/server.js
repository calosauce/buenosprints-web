require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { crearPedido, obtenerPedido, marcarPagado, mantenimiento } = require("./lib/db");
const { generarPDFPedido } = require("./lib/pdf");
const { enviarCotizacionAlTaller } = require("./lib/email");
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
  const esFactura = pedido.estado === "pagado";
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

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Ruta TEMPORAL de un solo uso: limpia los pedidos de prueba y arranca la
// numeración interna en el número que corresponda para no chocar con las
// órdenes que ya se llevan a mano. Se quita en el próximo commit.
app.post("/api/admin/mantenimiento-7cd5b2eb", async (req, res) => {
  try {
    const resultado = await mantenimiento(req.body || {});
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Buenos Prints backend escuchando en :${PORT}`));
