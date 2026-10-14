// Genera el PDF de cotización (pre-pago) o comprobante interno (post-pago),
// calcado del formato que el taller ya usa a mano (mismo orden de datos,
// mismas franjas rojas, mismo pie de página) para que el cliente reciba
// exactamente lo que está acostumbrado a ver, pero generado automáticamente.
//
// No incluye número de e-CF: DGII aún no habilita a Buenos Prints para eso.
// El día que lo haga, se agrega como una línea más junto a "COTIZACION #" —
// el resto del documento no cambia.

const PDFDocument = require("pdfkit");

const ROJO = "#EF4136";
const NEGRO = "#1A1A1A";
const GRIS_FILA = "#E7E9F0";
const ANCHO_PAGINA = 612; // carta
const MARGEN = 42;

function money(centavos) {
  return `RD$${(centavos / 100).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function generarPDFPedido(pedido, { esFactura = false } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: MARGEN });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const detalle = JSON.parse(pedido.detalle_json);
    const items = detalle.items || [];
    const fecha = new Date(pedido.creado_en).toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", year: "2-digit" });
    const anchoDer = 170;
    const xDer = ANCHO_PAGINA - MARGEN - anchoDer;

    // ---- Encabezado: logo/nombre a la izquierda, caja de datos a la derecha ----
    doc.font("Helvetica-Bold").fontSize(26).fillColor(ROJO)
      .text("BUENOS PRINTS", MARGEN, MARGEN - 4, { characterSpacing: 0.5 });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(NEGRO)
      .text("BUENOS PRINTS.", MARGEN, MARGEN + 34);
    doc.font("Helvetica").fontSize(10).fillColor(NEGRO)
      .text("Tel: 849-577-9893", MARGEN, MARGEN + 48);

    doc.font("Helvetica-Bold").fontSize(22).fillColor(ROJO)
      .text(esFactura ? "COMPROBANTE" : "COTIZACION", xDer - 40, MARGEN - 4, { width: anchoDer + 40, align: "right" });

    let yCaja = MARGEN + 34;
    const filaCaja = (etiqueta, valor) => {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(NEGRO).text(etiqueta, xDer, yCaja + 3, { width: 78 });
      doc.rect(xDer + 80, yCaja, anchoDer - 80, 16).fillAndStroke("#F4F4F6", "#CCCCCC");
      doc.font("Helvetica").fontSize(9).fillColor(NEGRO).text(valor, xDer + 84, yCaja + 3);
      yCaja += 20;
    };
    filaCaja("FECHA:", fecha);
    filaCaja(esFactura ? "COMPROBANTE #" : "COTIZACION #", pedido.numero);
    if (esFactura) filaCaja("e-CF:", pedido.ecf_numero || "— pendiente DGII —");

    // ---- Banda CLIENTE ----
    let y = MARGEN + 100;
    doc.rect(MARGEN, y, ANCHO_PAGINA - 2 * MARGEN, 18).fill(ROJO);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#FFFFFF").text("CLIENTE", MARGEN + 8, y + 4);
    y += 26;
    doc.font("Helvetica").fontSize(10).fillColor(NEGRO);
    doc.text(pedido.cliente_nombre || "-", MARGEN, y);
    y += 16;
    if (pedido.cliente_telefono) { doc.text(`Tel/Whatsapp: ${pedido.cliente_telefono}`, MARGEN, y); y += 14; }
    doc.text(`Email: ${pedido.cliente_email || "N/A"}`, MARGEN, y);
    y += 24;

    // ---- Tabla de items ----
    const colDescW = 360, colCantW = 70, colSubW = ANCHO_PAGINA - 2 * MARGEN - colDescW - colCantW;
    const xDesc = MARGEN, xCant = xDesc + colDescW, xSub = xCant + colCantW;

    doc.rect(MARGEN, y, ANCHO_PAGINA - 2 * MARGEN, 18).fill(ROJO);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#FFFFFF");
    doc.text("DESCRIPCION", xDesc + 8, y + 5);
    doc.text("CANTIDAD", xCant, y + 5, { width: colCantW, align: "center" });
    doc.text("SUB-TOTAL", xSub, y + 5, { width: colSubW - 8, align: "right" });
    y += 18;

    items.forEach((item, i) => {
      const medida = item.w && item.h ? `Medida: ${item.w}" x ${item.h}".` : "";
      const linea1 = `"${item.producto || ""}".${medida ? " " + medida : ""} Cantidad: ${item.cantidad || ""} unds`;
      const linea2 = [item.forma ? `DIE CUT: ${item.forma}.` : null, item.material || null].filter(Boolean).join(" ");
      const alto = linea2 ? 34 : 20;

      if (i % 2 === 0) doc.rect(MARGEN, y, ANCHO_PAGINA - 2 * MARGEN, alto).fill(GRIS_FILA);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(NEGRO).text(linea1, xDesc + 8, y + 4, { width: colDescW - 16 });
      if (linea2) doc.font("Helvetica").fontSize(8.5).fillColor("#444").text(linea2, xDesc + 8, y + 16, { width: colDescW - 16 });
      doc.font("Helvetica").fontSize(9).fillColor(NEGRO).text("1", xCant, y + 4, { width: colCantW, align: "center" });
      doc.text(money(item.precioTotal || 0), xSub, y + 4, { width: colSubW - 8, align: "right" });
      y += alto;
    });
    y += 14;

    // ---- Comentarios (izquierda) + Totales (derecha) ----
    const yComentarios = y;
    doc.rect(MARGEN, yComentarios, 330, 18).fill(ROJO);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#FFFFFF").text("COMENTARIOS", MARGEN + 8, yComentarios + 4);
    let yc = yComentarios + 26;
    doc.font("Helvetica").fontSize(8.7).fillColor(NEGRO);
    const comentarios = detalle.comentarios || [
      "Se coloca la orden con el 50% de avance.",
      "Se inicia la orden luego de aprobación de la prueba digital (foto).",
      "48-72 hrs para entrega.",
      "Envío gratis en órdenes de monto igual o superior a RD$5,000.00.",
    ];
    comentarios.forEach((c, i) => {
      doc.text(`${i + 1}. ${c}`, MARGEN, yc, { width: 320 });
      yc += doc.heightOfString(`${i + 1}. ${c}`, { width: 320 }) + 6;
    });

    let yt = yComentarios;
    const xEtiqueta = xSub - 90, anchoValor = colSubW + colCantW - 10;
    const filaTotal = (etiqueta, valor, destacado = false) => {
      doc.font(destacado ? "Helvetica-Bold" : "Helvetica").fontSize(destacado ? 11 : 9.5).fillColor(NEGRO);
      doc.text(etiqueta, xEtiqueta, yt + 3);
      if (destacado) doc.rect(xSub - 4, yt - 2, colSubW + 4, 18).fill(GRIS_FILA).fillColor(NEGRO).font("Helvetica-Bold").fontSize(11);
      doc.text(valor, xSub, yt + 3, { width: colSubW - 8, align: "right" });
      yt += 20;
    };
    filaTotal("Subtotal", money(pedido.subtotal));
    if (detalle.descuento) filaTotal("Descuento", `-${money(detalle.descuento)}`);
    if (detalle.rush) filaTotal("Servicio RUSH", money(detalle.rush));
    filaTotal("Envío", detalle.envio ? money(detalle.envio) : "Gratis");
    yt += 4;
    filaTotal(esFactura ? "TOTAL PAGADO" : "TOTAL", money(pedido.total), true);

    // ---- Pie de página ----
    const yPie = 740;
    doc.font("Helvetica").fontSize(9).fillColor(NEGRO)
      .text("Cualquier duda o pregunta por favor escribirnos vía WhatsApp y/o correo.", MARGEN, yPie, { width: ANCHO_PAGINA - 2 * MARGEN, align: "center" });
    doc.text("849-577-9893 / buenosprints.taller@gmail.com", MARGEN, yPie + 14, { width: ANCHO_PAGINA - 2 * MARGEN, align: "center" });
    doc.font("Helvetica-BoldOblique").text("¡Gracias por preferirnos!", MARGEN, yPie + 30, { width: ANCHO_PAGINA - 2 * MARGEN, align: "center" });

    if (!esFactura) {
      doc.font("Helvetica-Oblique").fontSize(8).fillColor("#888")
        .text("Esta cotización no es una factura. Para confirmar el pedido, realiza el pago y contesta por WhatsApp.", MARGEN, yPie + 48, { width: ANCHO_PAGINA - 2 * MARGEN, align: "center" });
    } else if (!pedido.ecf_numero) {
      doc.font("Helvetica-Oblique").fontSize(8).fillColor("#888")
        .text("Buenos Prints está en proceso de habilitación de e-CF con DGII — este documento aún no tiene valor fiscal.", MARGEN, yPie + 48, { width: ANCHO_PAGINA - 2 * MARGEN, align: "center" });
    }

    doc.end();
  });
}

module.exports = { generarPDFPedido };
