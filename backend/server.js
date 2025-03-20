require("dotenv").config();  // Cargar variables de entorno desde .env
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const axios = require("axios");
const http = require("http");
const socketIo = require("socket.io");  // Importar socket.io
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;


// Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 📌 Conexión a MySQL
const db = mysql.createConnection({
  host: '34.51.13.114',        // 🔹 Dirección IP pública de la instancia de Cloud SQL
  user: 'root',                
  password: 'integradora2025',   
  database: 'checkmekit',      
  port: 3306,                  
});

db.connect((err) => {
  if (err) {
    console.error("❌ Error al conectar a MySQL:", err);
  } else {
    console.log("✅ Conectado a Google Cloud SQL con éxito!");
  }
});

// 📌 Conexión a MongoDB Atlas (SIN watch())
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ Conectado a MongoDB Atlas"))
  .catch((err) => console.error("❌ Error al conectar a MongoDB:", err));

// 📌 Definir el esquema y modelo de MongoDB para los registros de IoT
const registroSchema = new mongoose.Schema({
  bpm: Number,
  spo2: Number,
  estado: String,
  fecha: Date,
  hora: String,
});

const Registro = mongoose.model("RegistroSignosVitales", registroSchema);

// 📌 Ruta para obtener los últimos 20 registros de MongoDB
app.get("/api/datos", async (req, res) => {
  try {
    const registros = await Registro.find().sort({ fecha: -1 }).limit(20);
    res.status(200).json(registros);
  } catch (error) {
    res.status(500).json({ error: "❌ Error al obtener los datos de MongoDB" });
  }
});

// 📌 Crear el servidor HTTP para usar con socket.io
const server = http.createServer(app);
const io = socketIo(server);  // Configuración de Socket.io

// 📌 Configuración de Socket.io para la mensajería en tiempo real
io.on("connection", (socket) => {
  console.log("Un usuario se ha conectado al chat");

  // Escuchar el evento de mensaje enviado por el paciente
  socket.on("enviar-mensaje", async (data) => {
    try {
      // Solo los mensajes del paciente llegan al doctor
      if (data.emisor === "paciente" && data.receptor === "doctor") {
        // Guardar el mensaje en MongoDB
        const nuevoMensaje = new Mensaje({
          emisor: data.emisor,
          receptor: data.receptor,
          mensaje: data.mensaje,
        });

        await nuevoMensaje.save();

        // Emitir el mensaje solo al doctor (no a todos los usuarios conectados)
        io.emit("mensaje-recibido", nuevoMensaje);
      }

      // Lógica para cuando el doctor responde
      if (data.emisor === "doctor" && data.receptor === "paciente") {
        const nuevoMensaje = new Mensaje({
          emisor: data.emisor,
          receptor: data.receptor,
          mensaje: data.mensaje,
        });

        await nuevoMensaje.save();

        // Emitir el mensaje de vuelta al paciente
        io.emit("mensaje-recibido", nuevoMensaje);
      }
    } catch (error) {
      console.error("❌ Error al guardar el mensaje:", error);
    }
  });

  // Escuchar cuando un cliente se desconecta
  socket.on("disconnect", () => {
    console.log("Un usuario se ha desconectado del chat");
  });
});
//--------------------------API PARA CONSULTAR LOS PACIENTES PARA LAS GRAFICAS------------------------------//

// API para obtener listado de pacientes claramente desde base relacional
app.get('/api/pacientes', async (req, res) => {
  try {
    const [resultados] = await db.promise().query("SELECT id_usuario, nombre FROM checkme_usuarios");
    res.json(resultados);
  } catch (error) {
    console.error("Error al obtener pacientes:", error);
    res.status(500).json({ error: "Error del servidor al obtener pacientes." });
  }
});







//----------------------------APIS PARA EL PACIENTE-------------------//

// ------------------------- REGISTRO DE USUARIO ---------------------------------------------
app.post("/api/register", async (req, res) => {
  const { nombre, apellido, correo, password, genero, edad } = req.body;

  if (!nombre || !apellido || !correo || !password || !genero || !edad) {
    return res.status(400).json({ success: false, message: "Todos los campos son obligatorios." });
  }

  try {
    const [results] = await db.promise().query("SELECT correo FROM checkme_usuarios WHERE correo = ?", [correo]);

    if (results.length > 0) {
      return res.status(400).json({ success: false, message: "El correo ya está registrado." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.promise().query(
      "INSERT INTO checkme_usuarios (nombre, apellido, correo, password, genero, edad, sesion_activa, session_token) VALUES (?, ?, ?, ?, ?, ?, 0, NULL)",
      [nombre, apellido, correo, hashedPassword, genero, edad]
    );

    res.status(201).json({ success: true, message: "Usuario registrado con éxito" });

  } catch (error) {
    console.error("❌ Error en registro:", error);
    res.status(500).json({ success: false, message: "Error en el servidor." });
  }
});

// ------------------------- VERIFICACIÓN DE USUARIO (DOCTOR O PACIENTE) ---------------------
app.post("/api/checkUser", async (req, res) => {
  const { correo } = req.body;

  if (!correo) return res.status(400).json({ success: false, message: "Correo requerido." });

  try {
    if (correo === "doctor.checkmekit@gmail.com") {
      return res.status(200).json({ success: true, role: "doctor" });
    }

    const [results] = await db.promise().query("SELECT id_usuario FROM checkme_usuarios WHERE correo = ?", [correo]);

    if (results.length > 0) {
      return res.status(200).json({ success: true, role: "patient", id_usuario: results[0].id_usuario });
    } else {
      return res.status(404).json({ success: false, message: "Correo no registrado." });
    }
  } catch (error) {
    console.error("❌ Error en verificación de usuario:", error);
    res.status(500).json({ success: false, message: "Error en el servidor." });
  }
});




// ------------------------- INICIO DE SESIÓN CON SESIÓN ÚNICA EN UNA PESTAÑA ----------------
app.post("/api/login", async (req, res) => {
  const { correo, password, forzarLogin } = req.body;

  if (!correo || !password) {
    return res.status(400).json({ success: false, message: "Todos los campos son obligatorios." });
  }

  console.log(`🔑 Intentando iniciar sesión con correo: ${correo}`);

  try {
    // 1️⃣ Verificar si el usuario existe en la base de datos
    const [results] = await db.promise().query("SELECT * FROM checkme_usuarios WHERE correo = ?", [correo]);

    if (results.length === 0) {
      console.log("❌ Usuario no encontrado en la base de datos.");
      return res.status(404).json({ success: false, message: "Correo electrónico incorrecto." });
    }

    const user = results[0];
    console.log("✅ Usuario encontrado:", user);

    // 2️⃣ Comparar la contraseña ingresada con la almacenada en la base de datos
    const isMatch = await bcrypt.compare(password, user.password);
    console.log("🔑 Comparación de contraseñas:", isMatch);

    if (!isMatch) {
      console.log("❌ Contraseña incorrecta.");
      return res.status(401).json({ success: false, message: "Contraseña incorrecta." });
    }

    // 3️⃣ Validar si la sesión ya está activa
    if (user.sesion_activa === 1) {
      if (forzarLogin) {
        console.log("⚠ Sobrescribiendo sesión anterior...");
        await db.promise().query("UPDATE checkme_usuarios SET sesion_activa = 0, session_token = NULL WHERE id_usuario = ?", [user.id_usuario]);
      } else {
        console.log("⛔ Sesión activa detectada, requiere confirmación.");
        return res.status(400).json({ success: false, message: "El usuario ya tiene una sesión activa en otro dispositivo.", askForForce: true });
      }
    }

    // 4️⃣ Generar un nuevo token de sesión
    console.log("🛡️ Generando nuevo token...");
    const sessionToken = crypto.randomUUID();
    console.log("✅ Token generado:", sessionToken);


    // ----------------------Stored Procedure para activar la sesion-----------//
    try {
      await db.promise().query("CALL iniciar_sesion(?)", [user.id_usuario]);
      console.log("✅ Sesión activada correctamente en la base de datos.");
    } catch (error) {
      console.error("❌ Error al activar sesión en la base de datos:", error);
      return res.status(500).json({ success: false, message: "Error al iniciar sesión." });
    }

    // 6️⃣ Guardar el sessionToken después de activar la sesión
    await db.promise().query("UPDATE checkme_usuarios SET session_token = ? WHERE id_usuario = ?", 
    [sessionToken, user.id_usuario]);

    console.log("✅ Sesión activada correctamente en Node.js.");

    // 7️⃣ Responder con éxito
    res.status(200).json({
      success: true,
      role: "patient",
      id_usuario: user.id_usuario,
      sessionToken,
    });

  } catch (error) {
    console.error("❌ Error en el login:", error);
    res.status(500).json({ success: false, message: "Error en el servidor." });
  }
});



// ------------------------- VALIDAR SESIÓN ÚNICA EN UNA SOLA PESTAÑA -------------------------
app.post("/api/validateSession", async (req, res) => {
  const { id_usuario, sessionToken } = req.body;

  if (!id_usuario || !sessionToken) {
    return res.status(400).json({ success: false, message: "ID de usuario y token requeridos." });
  }

  try {
    const [results] = await db.promise().query("SELECT session_token FROM checkme_usuarios WHERE id_usuario = ?", [id_usuario]);

    if (results.length === 0 || results[0].session_token !== sessionToken) {
      return res.status(401).json({ success: false, message: "Sesión no válida o abierta en otra pestaña." });
    }

    res.status(200).json({ success: true, message: "Sesión válida." });

  } catch (error) {
    console.error("❌ Error validando sesión:", error);
    res.status(500).json({ success: false, message: "Error en el servidor." });
  }
});

// ------------------------- CIERRE DE SESIÓN ----------------------------------------------


app.post("/api/logout", async (req, res) => {
  const { id_usuario } = req.body;

  if (!id_usuario) {
    return res.status(400).json({ success: false, message: "ID de usuario requerido." });
  }

  try {                    //---STORE PROCEDURE-----//
    await db.promise().query("CALL cerrar_sesion(?)", [id_usuario]);

    res.status(200).json({ success: true, message: "Sesión cerrada exitosamente." });

  } catch (error) {
    console.error("❌ Error cerrando sesión:", error);
    res.status(500).json({ success: false, message: "Error en el servidor." });
  }
});


//-----------------------------------------Doctor---------------------------------------------------//

// ------------------------- INICIO DE SESIÓN CON GOOGLE (DOCTOR) -----------------------
app.post("/api/google-login", async (req, res) => {
  const { email, forzarLogin } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Correo de Google es requerido." });
  }

  try {
    const [results] = await db.promise().query("SELECT * FROM checkme_doctor WHERE correo = ?", [email]);

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: "Correo no registrado como doctor." });
    }

    const doctor = results[0];

    // Verificar si el doctor ya tiene una sesión activa
    if (doctor.sesion_activa === 1) {
      if (forzarLogin) {
        console.log("⚠ Sobrescribiendo sesión previa...");
        await db.promise().query("UPDATE checkme_doctor SET sesion_activa = 0, session_token = NULL WHERE id_doctor = ?", [doctor.id_doctor]);
      } else {
        console.warn("⛔ El doctor ya tiene una sesión activa en otro dispositivo.");
        return res.status(400).json({ success: false, message: "El doctor ya tiene una sesión activa en otro dispositivo.", askForForce: true });
      }
    }

    // 🔍 Generar un nuevo token de sesión
    const sessionToken = crypto.randomUUID();
    console.log("🔑 Token generado:", sessionToken);

    // 🛠️ Actualizar sesión en la base de datos
    const [updateResult] = await db.promise().query(
      "UPDATE checkme_doctor SET sesion_activa = 1, session_token = ? WHERE id_doctor = ?",
      [sessionToken, doctor.id_doctor]
    );

    if (updateResult.affectedRows === 0) {
      console.error("❌ No se pudo actualizar la sesión del doctor en la base de datos.");
      return res.status(500).json({ success: false, message: "Error actualizando sesión del doctor." });
    }

    console.log("✅ Sesión activada correctamente en la base de datos.");

    res.status(200).json({
      success: true,
      role: "doctor",
      id_doctor: doctor.id_doctor,
      sessionToken: sessionToken
    });

  } catch (error) {
    console.error("❌ Error en el login con Google:", error);
    res.status(500).json({ success: false, message: "Error en el servidor." });
  }
});


// ------------------------- VALIDAR SESIÓN ÚNICA DEL DOCTOR -------------------------
app.post("/api/validateDoctorSession", async (req, res) => {
  const { id_doctor, sessionToken } = req.body;

  if (!id_doctor || !sessionToken) {
    return res.status(400).json({ success: false, message: "ID de doctor y token requeridos." });
  }

  try {
    const [results] = await db.promise().query("SELECT session_token FROM checkme_doctor WHERE id_doctor = ?", [id_doctor]);

    if (results.length === 0 || results[0].session_token !== sessionToken) {
      return res.status(401).json({ success: false, message: "Sesión no válida o abierta en otra pestaña." });
    }

    res.status(200).json({ success: true, message: "Sesión válida." });

  } catch (error) {
    console.error("❌ Error validando sesión del doctor:", error);
    res.status(500).json({ success: false, message: "Error en el servidor." });
  }
});


// ------------------------- CIERRE DE SESIÓN DEL DOCTOR -----------------------------------
app.post("/api/logoutDoctor", async (req, res) => {
  const { id_doctor } = req.body;

  if (!id_doctor) {
    return res.status(400).json({ success: false, message: "ID de doctor requerido." });
  }

  try {
    await db.promise().query("UPDATE checkme_doctor SET sesion_activa = 0, session_token = NULL WHERE id_doctor = ?", [id_doctor]);

    res.status(200).json({ success: true, message: "Sesión del doctor cerrada exitosamente." });

  } catch (error) {
    console.error("❌ Error cerrando sesión del doctor:", error);
    res.status(500).json({ success: false, message: "Error en el servidor." });
  }
});



//----------------------------------------SALDO ----------------------------------------------------------//

// 🔹 Ruta para almacenar o actualizar la cuenta de empresa
app.post("/api/empresa", (req, res) => {
    const { id_usuario, numero_cuenta, saldo } = req.body;

    if (!id_usuario || !numero_cuenta || saldo === undefined) {
        return res.status(400).json({ success: false, message: "Todos los campos son obligatorios." });
    }

    const checkSql = "SELECT id_empresa FROM checkme_empresa WHERE id_usuario = ?";
    db.query(checkSql, [id_usuario], (checkErr, checkResults) => {
        if (checkErr) {
            console.error("❌ Error al verificar empresa:", checkErr);
            return res.status(500).json({ success: false, message: "Error en el servidor al verificar la empresa." });
        }

        if (checkResults.length > 0) {
            const updateSql = "UPDATE checkme_empresa SET saldo = ?, numero_cuenta = ? WHERE id_usuario = ?";
            db.query(updateSql, [saldo, numero_cuenta, id_usuario], (updateErr) => {
                if (updateErr) {
                    return res.status(500).json({ success: false, message: "Error al actualizar saldo." });
                }
                res.json({ success: true, message: "Saldo actualizado correctamente." });
            });
        } else {
            const insertSql = "INSERT INTO checkme_empresa (id_usuario, numero_cuenta, saldo) VALUES (?, ?, ?)";
            db.query(insertSql, [id_usuario, numero_cuenta, saldo], (insertErr) => {
                if (insertErr) {
                    return res.status(500).json({ success: false, message: "Error al registrar la empresa." });
                }
                res.json({ success: true, message: "Cuenta registrada correctamente." });
            });
        }
    });
});


//------------------------CONSULTAR SALDO----------------------------//
// 🔹 Nueva API para consultar saldo por ID de usuario
app.get("/api/saldo/:id_usuario", async (req, res) => {
    const { id_usuario } = req.params;

    try {
        const [rows] = await db.promise().query(
            "SELECT saldo FROM checkme_empresa WHERE id_usuario = ?",
            [id_usuario]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado o sin cuenta registrada." });
        }

        res.json({ success: true, saldo: rows[0].saldo });
    } catch (error) {
        console.error("❌ Error al obtener el saldo:", error);
        res.status(500).json({ success: false, message: "Error al obtener el saldo." });
    }
});



//--------------------------------------COMPRA----------------------------------//


// 🔹 **Nueva API para verificar stock y precio del producto**
app.get("/api/stock/:id_producto", async (req, res) => {
    const { id_producto } = req.params;
    try {
        const [producto] = await db.promise().query(
            "SELECT stock, precio FROM checkme_producto WHERE id_producto = ?",
            [id_producto]
        );

        if (producto.length === 0) {
            return res.status(404).json({ success: false, message: "Producto no encontrado." });
        }

        res.json({ success: true, stock: producto[0].stock, precio: producto[0].precio });
    } catch (error) {
        console.error("❌ Error al obtener el stock:", error);
        res.status(500).json({ success: false, message: "Error al obtener el stock." });
    }
});

//---------------------------------------MANDAR ALERTAS CON TRIGGER------------------------------------//
app.get("/api/alertas-stock", async (req, res) => {
  try {
      const [alertas] = await db.promise().query("SELECT * FROM checkme_alerta_stock ORDER BY fecha_alerta DESC");
      res.json({ success: true, alertas });
  } catch (error) {
      res.status(500).json({ success: false, message: "Error obteniendo alertas de stock" });
  }
});



//------------------------------TRANSACCIÓN CON STORED PROCEDURE-----------------------------------------------//

app.post("/api/compra", async (req, res) => {
  const { id_usuario, id_producto, cantidad } = req.body;

  if (!id_usuario || !id_producto || !cantidad || cantidad <= 0) {
      return res.status(400).json({ success: false, message: "Todos los campos son obligatorios y la cantidad debe ser mayor a 0." });
  }

  try {
      console.log(`🛒 Iniciando compra: Usuario ${id_usuario}, Producto ${id_producto}, Cantidad ${cantidad}`);

      // Llamada al procedimiento store procedure
      const [result] = await db.promise().query(
          "CALL RealizarCompra(?, ?, ?)", 
          [id_usuario, id_producto, cantidad]
      );

      res.json({ success: true, message: "Compra realizada con éxito." });

  } catch (error) {
      console.error("⛔ ERROR DETECTADO EN LA TRANSACCIÓN:", error);

      let errorMessage = "Error en la transacción.";
      if (error.sqlMessage) {
          errorMessage = error.sqlMessage; // Captura el mensaje de error de MySQL
      }

      res.status(500).json({ success: false, message: errorMessage });
  }
});






//---------------------------------REPORTES MEDICOS ---------------------------------------------//

// Obtener la lista de todos los pacientes registrados
app.get("/pacientes", (req, res) => {
  const sql = `SELECT id_usuario, nombre, apellido, edad FROM checkme_usuarios`;
  
  db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

// Obtener información de un paciente específico
app.get("/paciente/:id", (req, res) => {
  const { id } = req.params;
  const sql = `SELECT nombre, apellido, edad FROM checkme_usuarios WHERE id_usuario = ?`;

  db.query(sql, [id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.length === 0) return res.status(404).json({ message: "Paciente no encontrado" });
    res.json(result[0]);
  });
});

// Guardar un nuevo reporte en el historial clínico
app.post("/historial", (req, res) => {
  const { id_paciente, oxigenacion, frecuencia_cardiaca, observaciones } = req.body;
  const sql = `INSERT INTO checkme_historial_clinico (id_paciente, oxigenacion, frecuencia_cardiaca, observaciones) VALUES (?, ?, ?, ?)`;

  db.query(sql, [id_paciente, oxigenacion, frecuencia_cardiaca, observaciones], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Reporte guardado correctamente" });
  });
});


//-----------------------------Reportes PDF ------------------------------------------------//
// Obtener el último reporte de un paciente específico
app.get("/historial/ultimo/:id_paciente", (req, res) => {
  const { id_paciente } = req.params;
  const sql = `SELECT * FROM checkme_historial_clinico WHERE id_paciente = ? ORDER BY fecha_registro DESC LIMIT 1`;

  db.query(sql, [id_paciente], (err, result) => {
      if (err) {
          console.error("Error al obtener historial clínico:", err);
          return res.status(500).json({ error: "Error al consultar la base de datos" });
      }
      if (result.length === 0) {
          return res.status(404).json({ error: "No hay registros para este paciente" });
      }
      res.json(result[0]);
  });
});


//-----------------------------CRUD de Producto---------------------------------------------//

// 🔹 Obtener todos los productos
app.get("/productos", (req, res) => {
    db.query("SELECT * FROM checkme_producto", (err, results) => {
      if (err) {
        console.error("❌ Error al obtener productos:", err);
        res.status(500).json({ error: "Error en el servidor" });
      } else {
        res.json(results);
      }
    });
  });
  
  // 🔹 Agregar un nuevo producto
  app.post("/productos", (req, res) => {
    const { nombre, descripcion, precio, stock } = req.body;
    if (!nombre || !descripcion || !precio || stock === undefined) {
      return res.status(400).json({ error: "Todos los campos son obligatorios" });
    }
  
    const query =
      "INSERT INTO checkme_producto (nombre, descripcion, precio, stock) VALUES (?, ?, ?, ?)";
    db.query(query, [nombre, descripcion, precio, stock], (err, result) => {
      if (err) {
        console.error("❌ Error al insertar producto:", err);
        res.status(500).json({ error: "Error en el servidor" });
      } else {
        res.status(201).json({
          id_producto: result.insertId,
          nombre,
          descripcion,
          precio,
          stock,
        });
      }
    });
  });
  
  // 🔹 Editar un producto por ID
  app.put("/productos/:id", (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, precio, stock } = req.body;
  
    if (!nombre || !descripcion || !precio || stock === undefined) {
      return res.status(400).json({ error: "Todos los campos son obligatorios" });
    }
  
    const query =
      "UPDATE checkme_producto SET nombre = ?, descripcion = ?, precio = ?, stock = ? WHERE id_producto = ?";
    db.query(query, [nombre, descripcion, precio, stock, id], (err, result) => {
      if (err) {
        console.error("❌ Error al actualizar producto:", err);
        res.status(500).json({ error: "Error en el servidor" });
      } else if (result.affectedRows === 0) {
        res.status(404).json({ error: "Producto no encontrado" });
      } else {
        res.status(200).json({
          id_producto: id,
          nombre,
          descripcion,
          precio,
          stock,
        });
      }
    });
  });
  
  // 🔹 Eliminar un producto por ID
  app.delete("/productos/:id", (req, res) => {
    const { id } = req.params;
    db.query("DELETE FROM checkme_producto WHERE id_producto = ?", [id], (err, result) => {
      if (err) {
        console.error("❌ Error al eliminar producto:", err);
        res.status(500).json({ error: "Error en el servidor" });
      } else if (result.affectedRows === 0) {
        res.status(404).json({ error: "Producto no encontrado" });
      } else {
        res.status(200).json({ message: "Producto eliminado correctamente" });
      }
    });
  });

//------------------------------------REPORTES CON TOTALES-------------------------------------------------//

//-----------------------------------------------------------------------------------------/
// API para obtener el reporte de ventas del mes
app.get("/api/reporte-ventas", async (req, res) => {
  try {
      console.log("📡 Consultando reporte de ventas por mes...");

      // Llamamos al Stored Procedure para obtener el resumen de ventas por mes
      const [result] = await db.promise().query("CALL ReporteVentasPorMes()");

      if (!result[0] || result[0].length === 0) {
          return res.status(200).json({ success: true, message: "No hay ventas registradas en este periodo.", data: [] });
      }

      let reporte = [];

      // Ahora obtenemos los detalles de cada mes desde la VistaReporteVentasPorMes
      for (let mesData of result[0]) {
          const [detalles] = await db.promise().query(
              `SELECT id_venta, fecha, cliente, total 
               FROM VistaReporteVentasPorMes
               WHERE mes = ?`,
              [mesData.mes]
          );

          reporte.push({
              ...mesData,
              ventas_detalle: detalles
          });
      }

      res.json({ success: true, data: reporte });

  } catch (error) {
      console.error("❌ ERROR en el servidor:", error.message, error.stack);
      res.status(500).json({ error: "Error interno del servidor", detalles: error.message });
  }
});





//--------------------------REPORTE USUARIOS-----------------------------------------//
app.get("/api/reporte-usuarios", (req, res) => {

                           //----------VISTA-----------//
  const query = `SELECT * FROM VistaUsuarios ORDER BY id_usuario ASC;`;

  db.query(query, (err, results) => {
    if (err) {
      console.error("❌ Error en MySQL:", err);
      return res.status(500).json({ error: "Error en MySQL", details: err.message });
    }

    // Verificar si hay usuarios registrados
    if (!results || results.length === 0) {
      return res.json({ usuarios: [], totalUsuarios: 0 });
    }

    res.json({ usuarios: results, totalUsuarios: results.length });
  });
});





// Iniciar el servidor
app.listen(port, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
});

