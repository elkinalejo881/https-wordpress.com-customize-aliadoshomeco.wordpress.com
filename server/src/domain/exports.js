import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

const COLS = [
  ['Número', r => r.number], ['Fecha', r => r.createdAt.toISOString().slice(0, 10)], ['Estado', r => r.status], ['Veterinario / clínica', r => r.clinicName],
  ['Paciente', r => r.patient.name], ['Especie', r => r.patient.species], ['Raza', r => r.patient.breed ?? ''], ['Edad', r => r.patient.age ?? ''],
  ['Propietario', r => r.patient.ownerName ?? ''], ['Tipo de muestra', r => r.sampleType], ['Fecha de toma', r => r.collectionDate ?? ''],
  ['Exámenes', r => r.items.map(i => i.name).join('; ')], ['Total COP', r => r.total], ['Observaciones', r => r.notes ?? ''],
];
/** Neutraliza "inyección de fórmulas": un texto que empiece con = + - @ se interpretaría como fórmula al abrir en Excel. */
export const safe = v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const csvCell = v => { const s = String(safe(v) ?? ''); return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function requestsCsv(rows) {
  const lines = [COLS.map(c => csvCell(c[0])).join(','), ...rows.map(r => COLS.map(c => csvCell(c[1](r))).join(','))];
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8'); // BOM: Excel abre bien las tildes
}
export async function requestsXlsx(rows, title = 'Solicitudes') {
  const wb = new ExcelJS.Workbook(); wb.creator = 'AsisVet'; const ws = wb.addWorksheet(title.slice(0, 30));
  ws.columns = COLS.map(c => ({ header: c[0], width: Math.min(40, Math.max(12, c[0].length + 4)) }));
  ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) ws.addRow(COLS.map(c => safe(c[1](r))));
  ws.getColumn(13).numFmt = '#,##0';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const cop = n => '$ ' + Number(n).toLocaleString('es-CO');
/** Orden de servicio (PDF) que acompaña la muestra. */
export function orderPdf({ lab, req }) {
  return new Promise((resolve, reject) => {
    const d = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Orden ${req.number}`, Author: lab.name } }), chunks = [];
    d.on('data', c => chunks.push(c)); d.on('end', () => resolve(Buffer.concat(chunks))); d.on('error', reject);
    d.fontSize(18).fillColor('#183B50').text(lab.name, { continued: false });
    d.fontSize(9).fillColor('#555').text([lab.nit && `NIT ${lab.nit}`, lab.city, lab.phone].filter(Boolean).join(' · '));
    d.moveDown(0.8).fontSize(15).fillColor('#000').text(`Orden de servicio ${req.number}`);
    d.fontSize(10).fillColor('#333').text(`Fecha de envío: ${req.createdAt.toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`);
    const kv = (k, v) => d.font('Helvetica-Bold').text(k + ': ', { continued: true }).font('Helvetica').text(String(v || '—'));
    d.moveDown(); d.fontSize(11).fillColor('#183B50').text('Remitente'); d.fontSize(10).fillColor('#000'); kv('Veterinario / clínica', req.clinicName); kv('Teléfono', req.clinicPhone);
    d.moveDown(); d.fontSize(11).fillColor('#183B50').text('Paciente'); d.fontSize(10).fillColor('#000');
    kv('Nombre', req.patient.name); kv('Especie', req.patient.species); kv('Raza', req.patient.breed); kv('Edad', req.patient.age); kv('Sexo', req.patient.sex); kv('Propietario', req.patient.ownerName);
    d.moveDown(); d.fontSize(11).fillColor('#183B50').text('Muestra'); d.fontSize(10).fillColor('#000'); kv('Tipo', req.sampleType); kv('Fecha de toma', req.collectionDate); kv('Observaciones', req.notes);
    d.moveDown(); d.fontSize(11).fillColor('#183B50').text('Exámenes solicitados'); d.fontSize(10).fillColor('#000');
    for (const i of req.items) { const y = d.y; d.text(`${i.code}  ${i.name}`, 48, y, { width: 380 }); d.text(cop(i.price), 440, y, { width: 107, align: 'right' }); }
    d.moveDown(0.5).font('Helvetica-Bold').text(`Total estimado: ${cop(req.total)}`, { align: 'right' }).font('Helvetica');
    d.moveDown(2).fontSize(8).fillColor('#777').text('Documento generado por AsisVet Laboratorio. El valor es estimado según el portafolio vigente del laboratorio.');
    d.end();
  });
}
