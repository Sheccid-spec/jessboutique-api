const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const html_to_pdf = require('html-pdf-node');

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

// ==========================================================
// DICCIONARIO TRADUCTOR DE CATEGORÍAS
// ==========================================================
function getCategoriaId(nombre) {
    const mapa = { "Vestidos": 1, "Camisas Dama": 2, "Camisas Hombre": 3, "Pantalones Dama": 4, "Pantalones Hombre": 5, "Carteras": 6, "Accesorios": 7 };
    return mapa[nombre] || 8; // 8 es General
}

function getCategoriaNombre(id) {
    const mapa = { 1: "Vestidos", 2: "Camisas Dama", 3: "Camisas Hombre", 4: "Pantalones Dama", 5: "Pantalones Hombre", 6: "Carteras", 7: "Accesorios" };
    return mapa[id] || "General";
}

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
            let costosTallasMap = {}; 
            
            let personalizarPrecio = prenda.PersonalizarPrecioPorTalla === true || prenda.PersonalizarPrecioPorTalla === 1;
            let personalizarCosto = prenda.PersonalizarCostoPorTalla === true || prenda.PersonalizarCostoPorTalla === 1; 

            tallasRes.recordset
                .filter(t => t.PrendaId === prenda.Id)
                .forEach(t => {
                    tallasDePrenda[t.Talla] = t.Cantidad;
                    
                    if (personalizarPrecio && t.PrecioVenta !== null) {
                        preciosTallasMap[t.Talla] = t.PrecioVenta.toString();
                    }
                    
                    if (personalizarCosto && t.CostoCompra !== null) {
                        costosTallasMap[t.Talla] = t.CostoCompra.toString();
                    }
                });

            return {
                id: prenda.Id,
                nombre: prenda.Nombre,
                costo: prenda.Costo.toString(),
                precio: prenda.Precio.toString(),
                tallas: tallasDePrenda,
                preciosTallas: Object.keys(preciosTallasMap).length > 0 ? preciosTallasMap : null,
                costosTallas: Object.keys(costosTallasMap).length > 0 ? costosTallasMap : null, 
                categoria: getCategoriaNombre(prenda.CategoriaId), // ¡AQUÍ TRADUCIMOS EL ID A NOMBRE!
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

        let personalizarPrecio = (prenda.preciosTallas && Object.keys(prenda.preciosTallas).length > 0) ? 1 : 0;
        let personalizarCosto = (prenda.costosTallas && Object.keys(prenda.costosTallas).length > 0) ? 1 : 0; 
        
        let catId = getCategoriaId(prenda.categoria); // TRADUCIMOS DE NOMBRE A ID

        await pool.request()
            .input('Id', sql.VarChar, prenda.id)
            .input('Nombre', sql.VarChar, prenda.nombre)
            .input('Costo', sql.Decimal(10, 2), prenda.costo)
            .input('Precio', sql.Decimal(10, 2), prenda.precio)
            .input('CategoriaId', sql.Int, catId) 
            .input('Mostrar', sql.Bit, prenda.mostrarEnCatalogo ? 1 : 0)
            .input('PersonalizarPrecio', sql.Bit, personalizarPrecio) 
            .input('PersonalizarCosto', sql.Bit, personalizarCosto) 
            .query(`
                INSERT INTO Prendas (Id, Nombre, Costo, Precio, CategoriaId, MostrarEnCatalogo, PersonalizarPrecioPorTalla, PersonalizarCostoPorTalla)
                VALUES (@Id, @Nombre, @Costo, @Precio, @CategoriaId, @Mostrar, @PersonalizarPrecio, @PersonalizarCosto)
            `);

        for (const talla in prenda.tallas) {
            let precioVenta = null;
            let costoCompra = null; 

            if (personalizarPrecio === 1 && prenda.preciosTallas[talla]) {
                precioVenta = parseFloat(prenda.preciosTallas[talla]);
                if (precioVenta <= 0) {
                    throw new Error(`El precio para la talla ${talla} debe ser mayor a 0`);
                }
            }

            if (personalizarCosto === 1 && prenda.costosTallas[talla]) {
                costoCompra = parseFloat(prenda.costosTallas[talla]);
                if (costoCompra <= 0) {
                    throw new Error(`El costo para la talla ${talla} debe ser mayor a 0`);
                }
            }

            await pool.request()
                .input('PrendaId', sql.VarChar, prenda.id)
                .input('Talla', sql.VarChar, talla)
                .input('Cantidad', sql.Int, prenda.tallas[talla])
                .input('PrecioVenta', sql.Decimal(10, 2), precioVenta) 
                .input('CostoCompra', sql.Decimal(10, 2), costoCompra) 
                .query(`
                    INSERT INTO Prenda_Tallas (PrendaId, Talla, Cantidad, PrecioVenta, CostoCompra)
                    VALUES (@PrendaId, @Talla, @Cantidad, @PrecioVenta, @CostoCompra)
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

        let personalizarPrecio = (prenda.preciosTallas && Object.keys(prenda.preciosTallas).length > 0) ? 1 : 0;
        let personalizarCosto = (prenda.costosTallas && Object.keys(prenda.costosTallas).length > 0) ? 1 : 0; 
        
        let catId = getCategoriaId(prenda.categoria); // TRADUCIMOS DE NOMBRE A ID

        await pool.request()
            .input('Id', sql.VarChar, id)
            .input('Nombre', sql.VarChar, prenda.nombre)
            .input('Costo', sql.Decimal(10, 2), prenda.costo)
            .input('Precio', sql.Decimal(10, 2), prenda.precio)
            .input('CategoriaId', sql.Int, catId) 
            .input('Mostrar', sql.Bit, prenda.mostrarEnCatalogo ? 1 : 0)
            .input('PersonalizarPrecio', sql.Bit, personalizarPrecio) 
            .input('PersonalizarCosto', sql.Bit, personalizarCosto) 
            .query(`
                UPDATE Prendas 
                SET Nombre = @Nombre, Costo = @Costo, Precio = @Precio, CategoriaId = @CategoriaId, MostrarEnCatalogo = @Mostrar, 
                    PersonalizarPrecioPorTalla = @PersonalizarPrecio, PersonalizarCostoPorTalla = @PersonalizarCosto
                WHERE Id = @Id
            `);

        await pool.request()
            .input('PrendaId', sql.VarChar, id)
            .query(`DELETE FROM Prenda_Tallas WHERE PrendaId = @PrendaId`);

        for (const talla in prenda.tallas) {
            let precioVenta = null;
            let costoCompra = null; 

            if (personalizarPrecio === 1 && prenda.preciosTallas[talla]) {
                precioVenta = parseFloat(prenda.preciosTallas[talla]);
                if (precioVenta <= 0) {
                    throw new Error(`El precio para la talla ${talla} debe ser mayor a 0`);
                }
            }

            if (personalizarCosto === 1 && prenda.costosTallas[talla]) {
                costoCompra = parseFloat(prenda.costosTallas[talla]);
                if (costoCompra <= 0) {
                    throw new Error(`El costo para la talla ${talla} debe ser mayor a 0`);
                }
            }

            await pool.request()
                .input('PrendaId', sql.VarChar, id)
                .input('Talla', sql.VarChar, talla)
                .input('Cantidad', sql.Int, prenda.tallas[talla])
                .input('PrecioVenta', sql.Decimal(10, 2), precioVenta) 
                .input('CostoCompra', sql.Decimal(10, 2), costoCompra) 
                .query(`
                    INSERT INTO Prenda_Tallas (PrendaId, Talla, Cantidad, PrecioVenta, CostoCompra)
                    VALUES (@PrendaId, @Talla, @Cantidad, @PrecioVenta, @CostoCompra)
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

// ==========================================================
// RUTA EXPORTAR INVENTARIO A PDF (GET)
// ==========================================================
app.get('/api/inventario/exportar', async (req, res) => {
    try {
        console.log("📄 Generando reporte PDF de inventario...");
        let pool = await sql.connect(dbConfig);
        
        let prendasRes = await pool.request().query('SELECT * FROM Prendas ORDER BY Nombre ASC');
        let tallasRes = await pool.request().query('SELECT * FROM Prenda_Tallas');

        let totalInvertido = 0;
        let totalVenta = 0;

        // --- 1. CONSTRUIR LAS FILAS DE LA TABLA EN HTML ---
        let filasHTML = '';

        prendasRes.recordset.forEach(prenda => {
            let tallasPrenda = tallasRes.recordset.filter(t => t.PrendaId === prenda.Id && t.Cantidad > 0);
            
            if (tallasPrenda.length > 0) {
                let personalizarCosto = prenda.PersonalizarCostoPorTalla === true || prenda.PersonalizarCostoPorTalla === 1;
                let personalizarPrecio = prenda.PersonalizarPrecioPorTalla === true || prenda.PersonalizarPrecioPorTalla === 1;

                tallasPrenda.forEach(t => {
                    let costoReal = personalizarCosto && t.CostoCompra !== null ? t.CostoCompra : prenda.Costo;
                    let precioReal = personalizarPrecio && t.PrecioVenta !== null ? t.PrecioVenta : prenda.Precio;
                    
                    let invertidoFila = costoReal * t.Cantidad;
                    let ventaFila = precioReal * t.Cantidad;

                    totalInvertido += invertidoFila;
                    totalVenta += ventaFila;
                    
                    let nombreCategoria = getCategoriaNombre(prenda.CategoriaId); // TRADUCTOR APLICADO AQUÍ

                    filasHTML += `
                        <tr>
                            <td><strong>${prenda.Nombre}</strong><br><span style="font-size: 10px; color: #666;">${nombreCategoria}</span></td>
                            <td style="text-align: center;">${t.Talla}</td>
                            <td style="text-align: center;">${t.Cantidad}</td>
                            <td style="text-align: right;">C$ ${costoReal.toFixed(2)}</td>
                            <td style="text-align: right;">C$ ${precioReal.toFixed(2)}</td>
                        </tr>
                    `;
                });
            }
        });

        // --- 2. DISEÑO HTML Y CSS DEL DOCUMENTO ---
        let htmlContent = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; margin: 0; padding: 20px; }
                .header { text-align: center; border-bottom: 3px solid #E91E63; padding-bottom: 15px; margin-bottom: 20px; }
                h1 { color: #E91E63; margin: 0; font-size: 28px; letter-spacing: 1px; }
                .subtitle { color: #666; font-size: 14px; margin-top: 5px; }
                
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
                th { background-color: #E91E63; color: white; padding: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
                td { padding: 8px 10px; border-bottom: 1px solid #eee; }
                tr:nth-child(even) { background-color: #fafafa; }
                
                .resumen-box { background-color: #fce4ec; border-radius: 8px; padding: 15px; margin-top: 30px; }
                .resumen-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
                .resumen-total { font-weight: bold; color: #E91E63; font-size: 18px; border-top: 1px solid #f8bbd0; padding-top: 8px; margin-top: 8px; }
                
                .footer { text-align: center; font-size: 10px; color: #999; margin-top: 40px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>JessBoutique</h1>
                <div class="subtitle">Reporte Oficial de Inventario y Valoración</div>
                <div class="subtitle" style="font-size: 12px;">Generado el: ${new Date().toLocaleDateString('es-NI', { timeZone: 'America/Managua' })}</div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="text-align: left;">Producto</th>
                        <th style="text-align: center;">Talla</th>
                        <th style="text-align: center;">Stock</th>
                        <th style="text-align: right;">Costo Und.</th>
                        <th style="text-align: right;">Precio Und.</th>
                    </tr>
                </thead>
                <tbody>
                    ${filasHTML}
                </tbody>
            </table>

            <div class="resumen-box">
                <div class="resumen-row">
                    <span>Capital Invertido Total:</span>
                    <span>C$ ${totalInvertido.toFixed(2)}</span>
                </div>
                <div class="resumen-row">
                    <span>Valor de Venta Total:</span>
                    <span>C$ ${totalVenta.toFixed(2)}</span>
                </div>
                <div class="resumen-row resumen-total">
                    <span>Ganancia Potencial Proyectada:</span>
                    <span>C$ ${(totalVenta - totalInvertido).toFixed(2)}</span>
                </div>
            </div>

            <div class="footer">
                Documento generado automáticamente por el sistema administrativo de JessBoutique.
            </div>
        </body>
        </html>
        `;

        // --- 3. CONVERTIR A PDF Y ENVIAR ---
        let options = { format: 'A4', margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" } };
        let file = { content: htmlContent };

        html_to_pdf.generatePdf(file, options).then(pdfBuffer => {
            res.contentType("application/pdf");
            res.setHeader('Content-Disposition', 'attachment; filename="Inventario_JessBoutique.pdf"');
            res.send(pdfBuffer);
            console.log("✅ PDF generado y enviado con éxito");
        });

    } catch (err) {
        console.error("❌ Error al generar PDF: ", err);
        res.status(500).send("Error interno al generar el documento");
    }
});

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
    console.log(`🚀 API de JessBoutique conectada a la nube en http://localhost:${PUERTO}`);
});