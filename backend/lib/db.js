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
      `INSERT INTO pedidos (numero, cliente_nombre, cliente_telefono, cliente_email, detalle_json, subtotal, total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [numero, cliente.nombre || null, cliente.telefono || null, cliente.email || null, JSON.stringify(detalle), subtotal, total]
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

async function marcarPagado(numero) {
  await asegurarTablas();
  await pool.query("UPDATE pedidos SET estado = 'pagado', pagado_en = NOW() WHERE numero = ?", [numero]);
  return obtenerPedido(numero);
}

// Uso único de mantenimiento: borra pedidos por número y/o fija el contador
// de un año a un valor exacto (el próximo pedido será valor+1). Ver la ruta
// temporal /api/admin/mantenimiento en server.js.
async function mantenimiento({ borrarNumeros = [], fijarContadorAnio = null, fijarContadorValor = null } = {}) {
  await asegurarTablas();
  if (borrarNumeros.length) {
    await pool.query("DELETE FROM pedidos WHERE numero IN (?)", [borrarNumeros]);
  }
  if (fijarContadorAnio && fijarContadorValor !== null) {
    const clave = `pedido-${fijarContadorAnio}`;
    await pool.query(
      "INSERT INTO contadores (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = ?",
      [clave, fijarContadorValor, fijarContadorValor]
    );
  }
  const [pedidos] = await pool.query("SELECT numero, estado FROM pedidos ORDER BY id");
  const [contadores] = await pool.query("SELECT clave, valor FROM contadores");
  return { pedidos, contadores };
}

module.exports = { crearPedido, obtenerPedido, marcarPagado, mantenimiento };
