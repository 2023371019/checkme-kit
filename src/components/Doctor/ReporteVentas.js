import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const generarReporteVentas = async () => {
  try {
    console.log("📡 Solicitando datos del reporte de ventas...");
    const response = await fetch("http://localhost:5000/api/reporte-ventas");

    if (!response.ok) {
      throw new Error(`Error en la API: ${response.status} - ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success || !data.data || !Array.isArray(data.data) || data.data.length === 0) {
      alert("No hay ventas registradas.");
      return;
    }

    console.log("✅ Datos obtenidos:", data.data);

    const doc = new jsPDF();
    doc.setFont("helvetica", "normal");

    // Cargar el logo desde "public"
    const logo = new Image();
    logo.src = "/logo.jpg";

    await new Promise((resolve) => {
      logo.onload = resolve;
    });

    // Agregar el logo y el título
    doc.addImage(logo, "JPEG", 10, 10, 25, 25);
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 30);
    doc.text("Reporte de Ventas por Mes", 105, 20, { align: "center" });

    // Fecha de generación
    const fechaActual = new Date().toLocaleDateString();
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    doc.text(`Fecha de generación: ${fechaActual}`, 105, 30, { align: "center" });

    let startY = 50;

    data.data.forEach((mesData) => {
      const {
        mes,
        total_ventas = 0,
        total_productos_vendidos = 0,
        ingresos_totales = 0,
        venta_mayor = 0,
        cliente_top = "N/A",
        ventas_detalle = [],
      } = mesData;

      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(50, 50, 150);
      doc.text(`Ventas de ${mes}`, 105, startY, { align: "center" });

      if (ventas_detalle.length > 0) {
        autoTable(doc, {
          startY: startY + 8,
          head: [["ID Venta", "Fecha", "Cliente", "Total"]],
          body: ventas_detalle.map((venta) => [
            venta.id_venta,
            new Date(venta.fecha).toLocaleDateString(), // Formato de fecha
            venta.cliente,
            `$${parseFloat(venta.total).toFixed(2)}`,
          ]),
          headStyles: { fillColor: [50, 50, 150], textColor: [255, 255, 255], fontStyle: "bold" },
          bodyStyles: { textColor: [40, 40, 40] },
          alternateRowStyles: { fillColor: [235, 235, 255] },
          margin: { top: 8 },
        });

        startY = doc.lastAutoTable.finalY + 10;
      } else {
        doc.setFontSize(12);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 100, 100);
        doc.text("No hay ventas registradas para este mes.", 105, startY + 8, { align: "center" });
        startY += 18;
      }

      // Tabla con resumen del mes
      autoTable(doc, {
        startY: startY + 8,
        head: [["Mes", "Total Ventas", "Productos Vendidos", "Ingresos Totales", "Venta Más Alta", "Cliente Destacado"]],
        body: [
          [
            mes,
            total_ventas,
            total_productos_vendidos,
            `$${parseFloat(ingresos_totales).toFixed(2)}`,
            `$${parseFloat(venta_mayor).toFixed(2)}`,
            cliente_top,
          ],
        ],
        headStyles: { fillColor: [50, 50, 150], textColor: [255, 255, 255], fontStyle: "bold" },
        bodyStyles: { textColor: [40, 40, 40] },
        alternateRowStyles: { fillColor: [235, 235, 255] },
        margin: { top: 8 },
      });

      startY = doc.lastAutoTable.finalY + 10;
    });

    // Pie de página
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text("Este es un documento generado automáticamente por CheckMe Kit.", 105, 280, { align: "center" });

    // Mostrar el PDF en una nueva pestaña
    const pdfBlob = doc.output("blob");
    const pdfUrl = URL.createObjectURL(pdfBlob);
    window.open(pdfUrl, "_blank");
  } catch (error) {
    console.error("❌ Error al generar el reporte de ventas:", error.message);
    alert("Hubo un error al generar el reporte.");
  }
};

export default generarReporteVentas;
