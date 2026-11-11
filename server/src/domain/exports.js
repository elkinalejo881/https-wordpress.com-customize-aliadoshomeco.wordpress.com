import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

const ST = { enviada: 'Enviada', en_proceso: 'En proceso', finalizada: 'Finalizada', rechazada: 'Rechazada', cancelada: 'Cancelada' };
const PST = { pend: 'Por recibir', rec: 'Recibida', done: 'Resultado entregado', rej: 'Rechazada' };
/** Una fila por paciente (así se trabaja en el laboratorio). */
const flat = rows => rows.flatMap(r => r.pats.map(p => ({ r, p })));
const COLS = [
  ['Solicitud', ({ r }) => r.code], ['Fecha', ({ r }) => r.createdAt.toISOString().slice(0, 10)], ['Estado solicitud', ({ r }) => ST[r.status] ?? r.status], ['Veterinario / clínica', ({ r }) => r.clinicName],
  ['N.º muestra', ({ p }) => p.no ?? ''], ['Paciente', ({ p }) => p.name], ['Especie', ({ p }) => p.species], ['Raza', ({ p }) => p.breed ?? ''], ['Edad', ({ p }) => p.age ?? ''],
  ['Acudiente', ({ p }) => p.owner ?? ''], ['Exámenes', ({ p }) => p.items.map(i => i.name).join('; ')], ['Estado paciente', ({ p }) => PST[p.st] ?? p.st], ['Urgente', ({ p }) => (p.urg ? 'Sí' : '')],
  ['Entrega', ({ r }) => (r.delivery === 'RECOGIDA' ? 'Recogida' : 'En laboratorio')], ['Valor COP', ({ p }) => p.subtotal], ['Observaciones', ({ p, r }) => [p.obs, p.why && `Rechazo: ${p.why}`, r.notes].filter(Boolean).join(' | ')],
];
/** Neutraliza "inyección de fórmulas": un texto que empiece con = + - @ se interpretaría como fórmula al abrir en Excel. */
export const safe = v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const csvCell = v => { const s = String(safe(v) ?? ''); return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function requestsCsv(rows) {
  const lines = [COLS.map(c => csvCell(c[0])).join(','), ...flat(rows).map(x => COLS.map(c => csvCell(c[1](x))).join(','))];
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8'); // BOM: Excel abre bien las tildes
}
export async function requestsXlsx(rows, title = 'Solicitudes') {
  const wb = new ExcelJS.Workbook(); wb.creator = 'AsisVet'; const ws = wb.addWorksheet(title.slice(0, 30));
  ws.columns = COLS.map(c => ({ header: c[0], width: Math.min(40, Math.max(12, c[0].length + 4)) }));
  ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const x of flat(rows)) ws.addRow(COLS.map(c => safe(c[1](x))));
  ws.getColumn(15).numFmt = '#,##0';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const cop = n => '$ ' + Number(n).toLocaleString('es-CO');
/** Orden de servicio (PDF) que acompaña las muestras. */
export function orderPdf({ lab, req }) {
  return new Promise((resolve, reject) => {
    const d = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Orden ${req.code}`, Author: lab.name } }), chunks = [];
    d.on('data', c => chunks.push(c)); d.on('end', () => resolve(Buffer.concat(chunks))); d.on('error', reject);
    d.fontSize(18).fillColor('#183B50').text(lab.name);
    d.fontSize(9).fillColor('#555').text([lab.nit && `NIT ${lab.nit}`, lab.city, lab.phone].filter(Boolean).join(' · '));
    d.moveDown(0.8).fontSize(15).fillColor('#000').text(`Orden de servicio ${req.code}${req.urg ? '  · URGENTE' : ''}`);
    d.fontSize(10).fillColor('#333').text(`Enviada: ${req.createdAt.toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`);
    const kv = (k, v) => d.font('Helvetica-Bold').text(k + ': ', { continued: true }).font('Helvetica').text(String(v || '—'));
    d.moveDown(); d.fontSize(11).fillColor('#183B50').text('Remitente'); d.fontSize(10).fillColor('#000');
    kv('Clínica', req.clinicName); kv('Veterinario', req.vetName); kv('Teléfono', req.clinicPhone); kv('Entrega de las muestras', req.delivery === 'RECOGIDA' ? `Recogida en ${req.addr}` : 'El veterinario las lleva al laboratorio'); if (req.hora) kv('Hora', req.hora); if (req.notes) kv('Observaciones', req.notes);
    req.pats.forEach((p, i) => {
      d.moveDown(); d.fontSize(11).fillColor('#183B50').text(`Paciente ${i + 1}: ${p.name}${p.urg ? '  (URGENTE)' : ''}`); d.fontSize(10).fillColor('#000');
      kv('Datos', [p.species, p.breed, p.sex, p.age].filter(Boolean).join(', ')); kv('Acudiente', p.owner); if (p.obs) kv('Observaciones', p.obs);
      for (const it of p.items) { const y = d.y; d.text(`${it.code}  ${it.name}`, 48, y, { width: 380 }); d.text(cop(it.price), 440, y, { width: 107, align: 'right' }); }
    });
    d.moveDown(0.8).font('Helvetica-Bold').text(`Total estimado: ${cop(req.total)}`, { align: 'right' }).font('Helvetica');
    d.moveDown(2).fontSize(8).fillColor('#777').text('Documento generado por AsisVet Laboratorio. El valor es estimado según el portafolio vigente del laboratorio.');
    d.end();
  });
}
