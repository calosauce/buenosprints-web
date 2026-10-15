// Persistencia de pedidos + numeración interna secuencial.
// Usa el MySQL incluido en el plan de hosting (no un archivo SQLite local):
// Hostinger reconstruye la carpeta de la app en cada despliegue de Git, así
// que cualquier dato guardado en disco ahí (como un .db de SQLite) se pierde
// con el siguiente "git push" — incluyendo la numeración interna de pedidos.
// MySQL vive fuera de esa carpeta y sobrevive a los despliegues.
//
// Las credenciales (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD) las puso
// Hostinger automáticamente como variables de entorno al crear la base
// (`hosting_databases_setup-website`) — nunca se escriben aquí ni se ven en
// texto plano en ningún lado.

const mysql = require("mysql2/promise");

// Estados posibles de un pedido (en este orden de flujo normal), y cuáles de
// ellos cuentan como "ya pagado" para efectos de (a) el PDF que se genera
// (cotización vs. comprobante) y (b) la fecha `pagado_en`. "cancelado" nunca
// cuenta como pagado aunque se llegue a él desde cualquier otro estado.
const ESTADOS = ["cotizado", "pagado_produccion", "listo_entrega", "entregado", "cancelado"];
const ESTADOS_PAGADOS = ["pagado_produccion", "listo_entrega", "entregado"];

// Hostinger entrega DB_HOST="localhost", pero en Node.js eso puede resolver a
// ::1 (IPv6) y el usuario de la base no siempre tiene permiso desde ahí.
// Forzamos 127.0.0.1 salvo que se indique explícitamente otro host (ej. para
// desarrollo local apuntando a otro servidor).
const DB_HOST = process.env.DB_HOST && process.env.DB_HOST !== "localhost"
  ? process.env.DB_HOST
  : "127.0.0.1";

const pool = mysql.createPool({
  host: DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
});

let listoPromesa = null;
async function asegurarTablas() {
  if (!listoPromesa) {
    listoPromesa = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS pedidos (
          id INT AUTO_INCREMENT PRIMARY KEY,
          numero VARCHAR(32) UNIQUE NOT NULL,
          estado VARCHAR(20) NOT NULL DEFAULT 'pendiente_pago',
          cliente_nombre VARCHAR(255),
          cliente_razon_social VARCHAR(255),
          cliente_rnc VARCHAR(32),
          cliente_telefono VARCHAR(50),
          cliente_email VARCHAR(255),
          detalle_json LONGTEXT NOT NULL,
          subtotal INT NOT NULL,
          total INT NOT NULL,
          ecf_numero VARCHAR(64),
          creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          pagado_en DATETIME NULL
        ) ENGINE=InnoDB;
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contadores (
          clave VARCHAR(32) PRIMARY KEY,
          valor INT NOT NULL
        ) ENGINE=InnoDB;
      `);
      // Migración liviana: si la tabla "pedidos" ya existía de antes (de un
      // despliegue previo a agregar razón social / RNC), se le agregan esas
      // columnas sin romper nada. Si ya existen, MySQL devuelve el error
      // 1060 (columna duplicada) y simplemente se ignora.
      for (const sql of [
        "ALTER TABLE pedidos ADD COLUMN cliente_razon_social VARCHAR(255) AFTER cliente_nombre",
        "ALTER TABLE pedidos ADD COLUMN cliente_rnc VARCHAR(32) AFTER cliente_razon_social",
      ]) {
        try {
          await pool.query(sql);
        } catch (err) {
          if (err.code !== "ER_DUP_FIELDNAME") throw err;
        }
      }
    })();
  }
  return listoPromesa;
}

// Incrementa el contador del año en una transacción con bloqueo de fila
// (SELECT ... FOR UPDATE), para que dos pedidos simultáneos nunca reciban el
// mismo número.
async function siguienteNumero(conn) {
  const year = new Date().getFullYear();
  const clave = `pedido-${year}`;
  await conn.query("INSERT IGNORE INTO contadores (clave, valor) VALUES (?, 0)", [clave]);
  const [rows] = await conn.query("SELECT valor FROM contadores WHERE clave = ? FOR UPDATE", [clave]);
  const siguiente = (rows[0]?.valor || 0) + 1;
  await conn.query("UPDATE contadores SET valor = ? WHERE clave = ?", [siguiente, clave]);
  return `BP-${year}-${String(siguiente).padStart(6, "0")}`;
}

async function crearPedido({ cliente, detalle, subtotal, total }) {
  await asegurarTablas();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const numero = await siguienteNumero(conn);
    await conn.query(
      `INSERT INTO pedidos (numero, estado, cliente_nombre, cliente_razon_social, cliente_rnc, cliente_telefono, cliente_email, detalle_json, subtotal, total)
       VALUES (?, 'cotizado', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numero,
        cliente.nombre || null,
        cliente.razonSocial || null,
        cliente.rnc || null,
        cliente.telefono || cliente.whatsapp || null,
        cliente.email || null,
        JSON.stringify(detalle),
        subtotal,
        total,
      ]
    );
    await conn.commit();
    return obtenerPedido(numero);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function obtenerPedido(numero) {
  await asegurarTablas();
  const [rows] = await pool.query("SELECT * FROM pedidos WHERE numero = ?", [numero]);
  return rows[0] || null;
}

// Cambia el estado de un pedido (usado por el endpoint que llama el Apps
// Script cuando alguien edita el dropdown "Estado" en Google Sheets, y por
// el endpoint viejo /pagar que se deja por compatibilidad).
// - Valida que el estado sea uno de los conocidos.
// - `pagado_en` se fija la PRIMERA vez que el pedido entra a un estado
//   "pagado" (pagado_produccion / listo_entrega / entregado) y nunca se
//   borra después (ni siquiera si luego se cancela), para no perder ese
//   dato histórico.
async function actualizarEstado(numero, estado) {
  await asegurarTablas();
  if (!ESTADOS.includes(estado)) {
    throw Object.assign(new Error(`Estado inválido: ${estado}`), { codigo: "ESTADO_INVALIDO" });
  }
  const pedido = await obtenerPedido(numero);
  if (!pedido) return null;

  const yaPagado = Boolean(pedido.pagado_en);
  const entraAPagado = ESTADOS_PAGADOS.includes(estado) && !yaPagado;

  if (entraAPagado) {
    await pool.query("UPDATE pedidos SET estado = ?, pagado_en = NOW() WHERE numero = ?", [estado, numero]);
  } else {
    await pool.query("UPDATE pedidos SET estado = ? WHERE numero = ?", [estado, numero]);
  }
  return obtenerPedido(numero);
}

// Se deja por compatibilidad con el endpoint viejo /api/pedidos/:numero/pagar
// (marcado a mano desde el taller antes de que existiera el dropdown).
async function marcarPagado(numero) {
  return actualizarEstado(numero, "pagado_produccion");
}

module.exports = { crearPedido, obtenerPedido, marcarPagado, actualizarEstado, ESTADOS, ESTADOS_PAGADOS };
