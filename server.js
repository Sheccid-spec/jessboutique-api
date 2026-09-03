const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json()); 

// --- CONFIGURACIÓN DE TU BASE DE DATOS EN LA NUBE (SOMEE) ---
const dbConfig = {
    user: 'Junior0325_SQLLogin_1', 
    password: 'yymx98rw43', 
    server: 'JessBoutiqueBD.mssql.somee.com', 
    database: 'JessBoutiqueBD',
    options: {
        encrypt: false, 
        trustServerCertificate: true 
    }
};

// --- RUTA: LEER INVENTARIO (GET) ---
app.get('/api/inventario', async (req, res) => {
    try {
        console.log("📱 ¡La aplicación pidió el inventario desde la nube!");
        let pool = await sql.connect(dbConfig);
        
        let prendasRes = await pool.request().query('SELECT * FROM Prendas');
        let tallasRes = await pool.request().query('SELECT * FROM Prenda_Tallas');

        let listaFinal = prendasRes.recordset.map(prenda => {
            let tallasDePrenda = {};
            let preciosTallasMap = {};
            
            // Verificamos si la prenda tiene la opción activada en la BD
            let personalizar = prenda.PersonalizarPrecioPorTalla === true || prenda.PersonalizarPrecioPorTalla === 1;

            tallasRes.recordset
                .filter(t => t.PrendaId === prenda.Id)
                .forEach(t => {
                    tallasDePrenda[t.Talla] = t.Cantidad;
                    
                    // Si tiene precios personalizados, los agregamos al mapa
                    if (personalizar && t.PrecioVenta !== null) {
                        preciosTallasMap[t.Talla] = t.PrecioVenta.toString();
                    }
                });

            return {
                id: prenda.Id,
                nombre: prenda.Nombre,
                costo: prenda.Costo.toString(),
                precio: prenda.Precio.toString(),
                tallas: tallasDePrenda,
                // Si el mapa de precios tiene datos, lo enviamos; si no, null
                preciosTallas: Object.keys(preciosTallasMap).length > 0 ? preciosTallasMap : null,
                categoria: prenda.CategoriaId === 1 ? "Vestidos" : "General",
                fotoUri: prenda.FotoUri,
                colores: prenda.Colores || "",
                descripcion: prenda.Descripcion || "",
                mostrarEnCatalogo: prenda.MostrarEnCatalogo === 1 || prenda.MostrarEnCatalogo === true
            };
        });

        res.json(listaFinal);
    } catch (err) {
        console.error("Error en la base de datos: ", err);
        res.status(500).send("Error en la base de datos");
    }
});

// --- RUTA: GUARDAR NUEVA PRENDA (POST) ---
app.post('/api/inventario', async (req, res) => {
    try {
        console.log("📥 Recibiendo nueva prenda...");
        let prenda = req.body; 
        let pool = await sql.connect(dbConfig);

        // Detectar si Android mandó precios personalizados
        let personalizarPrecio = (prenda.preciosTallas && Object.keys(prenda.preciosTallas).length > 0) ? 1 : 0;

        await pool.request()
            .input('Id', sql.VarChar, prenda.id)
            .input('Nombre', sql.VarChar, prenda.nombre)
            .input('Costo', sql.Decimal(10, 2), prenda.costo)
            .input('Precio', sql.Decimal(10, 2), prenda.precio)
            .input('CategoriaId', sql.Int, 1) 
            .input('Mostrar', sql.Bit, prenda.mostrarEnCatalogo ? 1 : 0)
            .input('Personalizar', sql.Bit, personalizarPrecio) // NUEVO CAMPO
            .query(`
                INSERT INTO Prendas (Id, Nombre, Costo, Precio, CategoriaId, MostrarEnCatalogo, PersonalizarPrecioPorTalla)
                VALUES (@Id, @Nombre, @Costo, @Precio, @CategoriaId, @Mostrar, @Personalizar)
            `);

        for (const talla in prenda.tallas) {
            let precioVenta = null;

            // Extraer y validar el precio individual si existe
            if (personalizarPrecio === 1 && prenda.preciosTallas[talla]) {
                precioVenta = parseFloat(prenda.preciosTallas[talla]);
                if (precioVenta <= 0) {
                    throw new Error(`El precio para la talla ${talla} debe ser mayor a 0`);
                }
            }

            await pool.request()
                .input('PrendaId', sql.VarChar, prenda.id)
                .input('Talla', sql.VarChar, talla)
                .input('Cantidad', sql.Int, prenda.tallas[talla])
                .input('PrecioVenta', sql.Decimal(10, 2), precioVenta) // NUEVO CAMPO
                .query(`
                    INSERT INTO Prenda_Tallas (PrendaId, Talla, Cantidad, PrecioVenta)
                    VALUES (@PrendaId, @Talla, @Cantidad, @PrecioVenta)
                `);
        }

        console.log("✅ Prenda guardada exitosamente en la nube");
        res.status(201).json({ mensaje: "Prenda guardada" });
    } catch (err) {
        console.error("❌ Error guardando la prenda: ", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- RUTA: REGISTRAR VENTA (POST) ---
app.post('/api/ventas', async (req, res) => {
    try {
        console.log("🛒 Registrando nueva venta...");
        let { ventaId, prendaId, usuarioId, talla, cantidad } = req.body; 
        let pool = await sql.connect(dbConfig);

        // SQL Server (sp_RegistrarVenta) se encarga de revisar el precio de la talla automáticamente
        let result = await pool.request()
            .input('VentaId', sql.VarChar, ventaId)
            .input('PrendaId', sql.VarChar, prendaId)
            .input('UsuarioId', sql.VarChar, usuarioId || 'Admin') 
            .input('Talla', sql.VarChar, talla)
            .input('Cantidad', sql.Int, cantidad)
            .execute('sp_RegistrarVenta'); 

        console.log("✅ Venta registrada y stock descontado en la nube");
        res.status(201).json(result.recordset ? result.recordset[0] : { mensaje: "Venta registrada" }); 
    } catch (err) {
        console.error("❌ Error al registrar venta: ", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================================
// RUTA PARA EDITAR PRENDA (PUT)
// ==========================================================
app.put('/api/inventario/:id', async (req, res) => {
    try {
        let id = req.params.id;
        let prenda = req.body;
        console.log(`✏️ Editando prenda con ID: ${id}...`);
        
        let pool = await sql.connect(dbConfig);

        // Detectar si Android mandó precios personalizados
        let personalizarPrecio = (prenda.preciosTallas && Object.keys(prenda.preciosTallas).length > 0) ? 1 : 0;

        await pool.request()
            .input('Id', sql.VarChar, id)
            .input('Nombre', sql.VarChar, prenda.nombre)
            .input('Costo', sql.Decimal(10, 2), prenda.costo)
            .input('Precio', sql.Decimal(10, 2), prenda.precio)
            .input('CategoriaId', sql.Int, 1) 
            .input('Mostrar', sql.Bit, prenda.mostrarEnCatalogo ? 1 : 0)
            .input('Personalizar', sql.Bit, personalizarPrecio) // NUEVO CAMPO
            .query(`
                UPDATE Prendas 
                SET Nombre = @Nombre, Costo = @Costo, Precio = @Precio, MostrarEnCatalogo = @Mostrar, PersonalizarPrecioPorTalla = @Personalizar
                WHERE Id = @Id
            `);

        await pool.request()
            .input('PrendaId', sql.VarChar, id)
            .query(`DELETE FROM Prenda_Tallas WHERE PrendaId = @PrendaId`);

        for (const talla in prenda.tallas) {
            let precioVenta = null;

            // Extraer y validar el precio individual si existe
            if (personalizarPrecio === 1 && prenda.preciosTallas[talla]) {
                precioVenta = parseFloat(prenda.preciosTallas[talla]);
                if (precioVenta <= 0) {
                    throw new Error(`El precio para la talla ${talla} debe ser mayor a 0`);
                }
            }

            await pool.request()
                .input('PrendaId', sql.VarChar, id)
                .input('Talla', sql.VarChar, talla)
                .input('Cantidad', sql.Int, prenda.tallas[talla])
                .input('PrecioVenta', sql.Decimal(10, 2), precioVenta) // NUEVO CAMPO
                .query(`
                    INSERT INTO Prenda_Tallas (PrendaId, Talla, Cantidad, PrecioVenta)
                    VALUES (@PrendaId, @Talla, @Cantidad, @PrecioVenta)
                `);
        }

        console.log("✅ Prenda actualizada correctamente");
        res.status(200).json({ mensaje: "Prenda actualizada" });
    } catch (err) {
        console.error("❌ Error al editar: ", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================================
// RUTA PARA ELIMINAR PRENDA (DELETE)
// ==========================================================
app.delete('/api/inventario/:id', async (req, res) => {
    try {
        let id = req.params.id;
        console.log(`🗑️ Eliminando prenda con ID: ${id}...`);
        let pool = await sql.connect(dbConfig);

        await pool.request()
            .input('Id', sql.VarChar, id)
            .query(`DELETE FROM Prenda_Tallas WHERE PrendaId = @Id`);

        await pool.request()
            .input('Id', sql.VarChar, id)
            .query(`DELETE FROM Prendas WHERE Id = @Id`);

        console.log("✅ Prenda eliminada por completo");
        res.status(200).json({ mensaje: "Prenda eliminada" });
    } catch (err) {
        console.error("❌ Error al eliminar: ", err.message);
        res.status(500).json({ error: "No se puede eliminar. Es posible que tenga ventas registradas." });
    }
});

// ==========================================================
// RUTA OBTENER HISTORIAL DE VENTAS (GET)
// ==========================================================
app.get('/api/ventas', async (req, res) => {
    try {
        console.log("📈 La aplicación pidió el historial de ventas");
        let pool = await sql.connect(dbConfig);
        
        let result = await pool.request().query('SELECT * FROM Ventas ORDER BY Fecha DESC');
        
        let ventas = result.recordset.map(v => ({
            id: v.Id,
            prendaId: v.PrendaId,
            nombreProducto: v.NombreProducto,
            talla: v.Talla,
            cantidad: v.Cantidad,
            precioUnitario: v.PrecioUnitario,
            costoUnitario: v.CostoUnitario,
            total: v.Total,
            gananciaTotal: v.GananciaTotal,
            fechaMillis: v.FechaMillis,
            anulada: v.Anulada
        }));

        res.json(ventas);
    } catch (err) {
        console.error("❌ Error al obtener ventas: ", err);
        res.status(500).send("Error al obtener ventas");
    }
});

// ==========================================================
// RUTA OBTENER HISTORIAL DE GASTOS (GET)
// ==========================================================
app.get('/api/gastos', async (req, res) => {
    try {
        console.log("💸 La aplicación pidió el historial de gastos");
        let pool = await sql.connect(dbConfig);
        
        let result = await pool.request().query(`
            SELECT g.Id, g.Concepto, c.Nombre AS Categoria, g.Monto, g.FechaMillis
            FROM Gastos g
            INNER JOIN CategoriasGasto c ON g.CategoriaId = c.Id
            ORDER BY g.Fecha DESC
        `);
        
        let gastos = result.recordset.map(g => ({
            id: g.Id,
            concepto: g.Concepto,
            categoria: g.Categoria,
            monto: g.Monto,
            fechaMillis: Number(g.FechaMillis) 
        }));

        res.json(gastos);
    } catch (err) {
        console.error("❌ Error al obtener gastos: ", err);
        res.status(500).send("Error al obtener gastos");
    }
});

// ==========================================================
// RUTA GUARDAR NUEVO GASTO (POST)
// ==========================================================
app.post('/api/gastos', async (req, res) => {
    try {
        console.log("📝 Recibiendo nuevo gasto...");
        let gasto = req.body; 
        let pool = await sql.connect(dbConfig);

        await pool.request()
            .input('Id', sql.VarChar, gasto.id)
            .input('UsuarioId', sql.VarChar, 'Admin') 
            .input('Concepto', sql.VarChar, gasto.concepto)
            .input('CategoriaNombre', sql.VarChar, gasto.categoria)
            .input('Monto', sql.Decimal(10, 2), gasto.monto)
            .input('FechaMillis', sql.BigInt, gasto.fechaMillis)
            .query(`
                DECLARE @CatId INT;
                SELECT @CatId = Id FROM CategoriasGasto WHERE Nombre = @CategoriaNombre;
                IF @CatId IS NULL SET @CatId = 10; 

                INSERT INTO Gastos (Id, UsuarioId, Concepto, CategoriaId, Monto, FechaMillis)
                VALUES (@Id, @UsuarioId, @Concepto, @CatId, @Monto, @FechaMillis)
            `);

        console.log("✅ Gasto registrado correctamente");
        res.status(201).json({ mensaje: "Gasto registrado" });
    } catch (err) {
        console.error("❌ Error al registrar gasto: ", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================================
// RUTA PARA ANULAR VENTA (PUT)
// ==========================================================
app.put('/api/ventas/:id/anular', async (req, res) => {
    try {
        let ventaId = req.params.id;
        let motivo = req.body.motivo || "Anulada desde la aplicación";
        console.log(`⚠️ Anulando venta con ID: ${ventaId}...`);

        let pool = await sql.connect(dbConfig);

        let result = await pool.request()
            .input('VentaId', sql.VarChar, ventaId)
            .input('Motivo', sql.NVarChar, motivo)
            .execute('sp_AnularVenta');

        console.log("✅ Venta anulada y stock devuelto exitosamente");
        res.status(200).json(result.recordset ? result.recordset[0] : { mensaje: "Venta anulada" });

    } catch (err) {
        console.error("❌ Error al anular venta: ", err.message);
        res.status(500).json({ error: err.message });
    }
});

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
    console.log(`🚀 API de JessBoutique conectada a la nube en http://localhost:${PUERTO}`);
});