// Montaje de "Hojas de stickers" en PDF a TAMAÑO REAL, para el taller.
//
// El carrito ya calculó el acomodo (item.montaje): tamaño de la hoja y la
// posición/medida en pulgadas de cada sticker. Aquí solo se dibuja:
//   Página 1 — la hoja (1 pulgada = 72 puntos), cada diseño en su lugar.
//   Página 2 — ficha con los datos para preparar el corte.
//
// PDFKit solo incrusta PNG y JPG. Para SVG/WEBP el navegador ya mandó una
// copia en PNG recortada (png64). Los PNG/JPG originales se usan tal cual y se
// recortan aquí con `recorte` (fracción del original sin bordes transparentes).

const PDFDocument = require("pdfkit");

const PT = 72;
// Igual que la vista previa: cada pieza es el tamaño de CORTE y el diseño va
// 8 pt hacia adentro (espacio del borde blanco), con su proporción, centrado.
const BORDE_PT = 8;
const ROJO = "#EF4136";
const NEGRO = "#1A1A1A";

function generarMontajePDF(item, { numero, indice = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const m = item.montaje;
    const W = m.hoja.w * PT, H = m.hoja.h * PT;
    const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `Montaje ${numero || ""} — hoja ${indice}` } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Una imagen por diseño (se reutiliza para todas sus copias).
    const imagenes = (item.archivos || []).map((a) => {
      try {
        const usarPng = Boolean(a.png64);
        const img = doc.openImage(Buffer.from(usarPng ? a.png64 : a.base64, "base64"));
        return { img, recorte: usarPng ? [0, 0, 1, 1] : (a.recorte || [0, 0, 1, 1]) };
      } catch (_) {
        return null; // formato que PDFKit no puede leer: se marca el lugar
      }
    });

    // ---- Página 1: la hoja ----
    for (const p of m.piezas || []) {
      const iw = Math.max(1, p.w * PT - 2 * BORDE_PT), ih = Math.max(1, p.h * PT - 2 * BORDE_PT);
      const r = p.w / p.h;
      const w = iw / ih > r ? ih * r : iw, h = iw / ih > r ? ih : iw / r;
      const x = p.x * PT + (p.w * PT - w) / 2, y = p.y * PT + (p.h * PT - h) / 2;
      const im = imagenes[p.d];
      if (!im) {
        doc.save().lineWidth(0.5).dash(3, { space: 3 }).rect(x, y, w, h).stroke("#999").undash().restore();
        doc.font("Helvetica").fontSize(7).fillColor("#999").text(`Diseño ${p.d + 1}`, x, y + h / 2 - 4, { width: w, align: "center", lineBreak: false });
        continue;
      }
      const [x0, y0, x1, y1] = im.recorte;
      const anchoTotal = w / (x1 - x0), altoTotal = h / (y1 - y0);
      doc.save();
      doc.rect(x, y, w, h).clip();
      doc.image(im.img, x - x0 * anchoTotal, y - y0 * altoTotal, { width: anchoTotal, height: altoTotal });
      doc.restore();
    }

    // ---- Página 2: ficha para el taller ----
    doc.addPage({ size: "LETTER", margin: 48 });
    doc.font("Helvetica-Bold").fontSize(20).fillColor(ROJO).text("Montaje de hoja de stickers");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(11).fillColor(NEGRO);
    const fila = (k, v) => { doc.font("Helvetica-Bold").text(`${k}: `, { continued: true }).font("Helvetica").text(String(v)); };
    if (numero) fila("Pedido", `${numero}${indice > 1 ? ` (hoja ${indice})` : ""}`);
    fila("Tamaño de la hoja", `${m.hoja.w}" × ${m.hoja.h}" (página 1, a tamaño real)`);
    fila("Stickers por hoja", `${(m.piezas || []).length}, lado mayor ${m.tam}"`);
    fila("Separación entre stickers", `${m.separacion}"`);
    fila("Borde de la hoja", `${m.margen}"`);
    fila("Borde blanco de cada sticker", `${BORDE_PT} pt (cada diseño está colocado ${BORDE_PT} pt hacia adentro de su espacio de corte)`);
    fila("Cantidad de hojas", item.cantidad);
    if (item.material) fila("Material", item.material);
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(13).fillColor(ROJO).text("Diseños");
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(11).fillColor(NEGRO);
    (item.archivos || []).forEach((a, i) => {
      const enHoja = (m.piezas || []).filter((p) => p.d === i).length;
      doc.text(`${i + 1}. ${a.nombre} — ${enHoja} ${enHoja === 1 ? "copia" : "copias"} por hoja${imagenes[i] ? "" : " (formato no incrustable: ver archivo adjunto)"}`);
    });
    doc.moveDown(0.8);
    doc.font("Helvetica-Oblique").fontSize(9).fillColor("#666")
      .text("Acomodo generado automáticamente desde buenosprints.com. Imprime la página 1 al 100% (sin ajustar a la página). Los archivos originales van adjuntos en el correo del pedido.");

    doc.end();
  });
}

module.exports = { generarMontajePDF };
