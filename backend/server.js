require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { crearPedido, obtenerPedido, marcarPagado, actualizarEstado, ESTADOS } = require("./lib/db");
const { generarPDFPedido } = require("./lib/pdf");
const { enviarCotizacionAlTaller, enviarActualizacionAlCliente, enviarConfirmacionAlCliente } = require("./lib/email");
const { telefonoCoincide, vistaPublica, crearLimitador } = require("./lib/rastreo");
const { linkWhatsApp } = require("./lib/whatsapp");
const { registrarPedidoEnSheet } = require("./lib/sheets");

const app = express();
// Hostinger pone un proxy delante de la app: sin esto, req.protocol sale
// "http" (los links al PDF quedaban en http://) y req.ip sería la del proxy.
app.set("trust proxy", 1);
app.use(cors());
// El carrito permite hasta 35 MB en archivos (CONFIG.MAX_MB_TOTAL en
// index.html) codificados en base64 — eso infla el tamaño real en ~33%, así
// que el límite aquí debe quedar bastante por encima de 35 MB, no igual.
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;

// Crea un pedido nuevo: recibe el carrito ya armado desde el front-end.
// Devuelve el número interno, el PDF en base64 y el link de WhatsApp listo para enviar.
app.post("/api/pedidos", async (req, res) => {
  try {
    const { cliente, detalle, subtotal, total } = req.body;
    if (!detalle || typeof subtotal !== "number" || typeof total !== "number") {
      return res.status(400).json({ error: "Faltan datos del pedido (detalle, subtotal, total)." });
    }

    // Cada item puede traer su diseño adjunto en base64 (archivo.base64,
    // armado por el front-end cuando el cliente sube un archivo en vez de
    // pegar un enlace). Eso NO se guarda en la base de datos (son binarios
    // pesados que ni lib/pdf.js ni lib/sheets.js necesitan) — se separa aquí
    // para mandarlo como adjunto en el correo al taller, y lo que sí se
    // guarda es la versión "liviana" del detalle (sin el base64).
    const items = Array.isArray(detalle.items) ? detalle.items : [];
    const archivosAdjuntos = items
      .filter((it) => it.archivo && it.archivo.base64)
      .map((it, i) => ({
        filename: it.archivo.nombre || it.nombreArchivo || `diseno-${i + 1}`,
        content: Buffer.from(it.archivo.base64, "base64"),
      }));
    const detalleLiviano = {
      ...detalle,
      items: items.map(({ archivo, ...resto }) => resto),
    };

    const pedido = await crearPedido({ cliente: cliente || {}, detalle: detalleLiviano, subtotal, total });
    const pdfBuffer = await generarPDFPedido(pedido, { esFactura: false });

    // El PDF se sirve desde esta misma API; el link de WhatsApp (con el
    // mensaje y los datos de pago ya armados) se calcula ANTES de avisarle
    // al taller, para poder incluirlo directo en ese correo.
    // Igual que lib/sheets.js: BASE_URL no está definido en Hostinger, así
    // que el valor por defecto es el dominio real (siempre https).
    const baseApi = process.env.BASE_URL || "https://api.buenosprints.com";
    const urlPdf = `${baseApi}/api/pedidos/${pedido.numero}/pdf`;
    const linkWa = linkWhatsApp(pedido, urlPdf);

    // El correo al taller es automático y no depende de nada más.
    let correoEnviado = true;
    try {
      await enviarCotizacionAlTaller(pedido, pdfBuffer, linkWa, archivosAdjuntos);
    } catch (err) {
      correoEnviado = false;
      console.error("No se pudo enviar el correo al taller:", err.message);
    }

    // Confirmación al CLIENTE (número de pedido + PDF + link de rastreo).
    // Igual que el del taller: si falla, el pedido ya quedó creado.
    let correoClienteEnviado = false;
    try {
      const r = await enviarConfirmacionAlCliente(pedido, pdfBuffer);
      correoClienteEnviado = Boolean(r?.ok);
    } catch (err) {
      console.error("No se pudo enviar la confirmación al cliente:", err.message);
    }

    // El registro en Sheets es best-effort: si no está configurado, simplemente se omite.
    registrarPedidoEnSheet(pedido).catch((err) => console.error("Sheets:", err.message));

    res.json({
      numero: pedido.numero,
      total: pedido.total,
      correoEnviado,
      correoClienteEnviado,
      pdfBase64: pdfBuffer.toString("base64"),
      linkWhatsApp: linkWa,
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

// Rastreo público (página buenosprints.com/rastreo). Pide el número de
// pedido + los últimos 4 dígitos del WhatsApp del pedido; si no coinciden
// responde exactamente lo mismo que si el pedido no existiera, para no
// confirmar qué números existen. Ver lib/rastreo.js.
const rastreoPermitido = crearLimitador({ max: 30, ventanaMs: 10 * 60 * 1000 });
app.get("/api/rastreo/:numero", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!rastreoPermitido(req.ip)) {
    return res.status(429).json({ error: "Demasiadas consultas. Espera unos minutos e intenta de nuevo." });
  }
  // Acepta el número con o sin ceros a la izquierda (BP-2026-720 =
  // BP-2026-000720), igual que la página de rastreo.
  const crudo = String(req.params.numero || "").trim().toUpperCase();
  const m = crudo.match(/^BP-(\d{4})-(\d{1,6})$/);
  const numero = m ? `BP-${m[1]}-${m[2].padStart(6, "0")}` : crudo;
  const tel = String(req.query.tel || "");
  const noEncontrado = () =>
    res.status(404).json({ error: "No encontramos un pedido con ese número y esos dígitos. Revisa los datos e intenta de nuevo." });

  if (!/^BP-\d{4}-\d{1,6}$/.test(numero) || !/^\d{4}$/.test(tel)) return noEncontrado();
  try {
    const pedido = await obtenerPedido(numero);
    if (!pedido || !telefonoCoincide(pedido, tel)) return noEncontrado();
    res.json(vistaPublica(pedido));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno al consultar el pedido." });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Buenos Prints backend escuchando en :${PORT}`));
