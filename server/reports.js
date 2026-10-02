'use strict';

const PDFDocument = require('pdfkit');
const rules = require('./rules');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { timeZone: process.env.TZ_DISPLAY || 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const yesNo = (v) => (v ? 'Oui' : 'Non');
const conf = (v) => (v ? 'C' : 'NC');

/** Définition des registres exportables : requête + colonnes. */
const REGISTERS = {
  temperatures: {
    title: 'Relevés de températures',
    photoEntity: 'temperature_logs',
    caption: (r) => `${r.equipment_name} : ${r.value} °C`,
    sql: `SELECT t.*, e.name AS equipment_name, e.min_temp, e.max_temp, u.name AS user_name FROM temperature_logs t
          JOIN equipment e ON e.id = t.equipment_id LEFT JOIN users u ON u.id = t.user_id
          WHERE t.org_id = ? AND t.recorded_at >= ? AND t.recorded_at < date(?, '+1 day') ORDER BY t.recorded_at`,
    columns: [
      ['Date', (r) => fmtDateTime(r.recorded_at), 95],
      ['Équipement', (r) => r.equipment_name, 120],
      ['Plage', (r) => `${r.min_temp ?? ''} / ${r.max_temp ?? ''}`, 60],
      ['T° (°C)', (r) => r.value, 50],
      ['Conf.', (r) => conf(r.compliant), 35],
      ['Commentaire', (r) => r.comment || '', 120],
      ['Opérateur', (r) => r.user_name || '', 80],
    ],
  },
  cleaning: {
    title: 'Plan de nettoyage et désinfection',
    photoEntity: 'cleaning_logs',
    caption: (r) => `Nettoyage ${r.zone} – ${r.task_name}`,
    sql: `SELECT t.*, c.zone, c.name AS task_name, c.product, u.name AS user_name FROM cleaning_logs t
          JOIN cleaning_tasks c ON c.id = t.task_id LEFT JOIN users u ON u.id = t.user_id
          WHERE t.org_id = ? AND t.done_at >= ? AND t.done_at < date(?, '+1 day') ORDER BY t.done_at`,
    columns: [
      ['Date', (r) => fmtDateTime(r.done_at), 95],
      ['Zone', (r) => r.zone, 90],
      ['Élément', (r) => r.task_name, 120],
      ['Produit', (r) => r.product || '', 90],
      ['Commentaire', (r) => r.comment || '', 125],
      ['Opérateur', (r) => r.user_name || '', 80],
    ],
  },
  receptions: {
    title: 'Contrôles à réception',
    photoEntity: 'receptions',
    caption: (r) => `Réception ${r.product}${r.supplier_name ? ` (${r.supplier_name})` : ''}${r.lot_number ? `, lot ${r.lot_number}` : ''}`,
    sql: `SELECT t.*, s.name AS supplier_name, u.name AS user_name FROM receptions t
          LEFT JOIN suppliers s ON s.id = t.supplier_id LEFT JOIN users u ON u.id = t.user_id
          WHERE t.org_id = ? AND t.received_at >= ? AND t.received_at < date(?, '+1 day') ORDER BY t.received_at`,
    columns: [
      ['Date', (r) => fmtDateTime(r.received_at), 80],
      ['Fournisseur', (r) => r.supplier_name || '', 80],
      ['Produit', (r) => r.product, 90],
      ['Lot', (r) => r.lot_number || '', 55],
      ['DLC', (r) => fmtDate(r.dlc), 55],
      ['T°', (r) => r.temperature ?? '', 35],
      ['Emb.', (r) => yesNo(r.packaging_ok), 30],
      ['Conf.', (r) => conf(r.compliant), 30],
      ['Opérateur', (r) => r.user_name || '', 65],
    ],
  },
  processes: {
    title: 'Refroidissements et remises en température',
    photoEntity: 'process_logs',
    caption: (r) => `${r.type === 'cooling' ? 'Refroidissement' : 'Remise en température'} ${r.product}`,
    sql: `SELECT t.*, u.name AS user_name FROM process_logs t LEFT JOIN users u ON u.id = t.user_id
          WHERE t.org_id = ? AND t.start_at >= ? AND t.start_at < date(?, '+1 day') ORDER BY t.start_at`,
    columns: [
      ['Type', (r) => (r.type === 'cooling' ? 'Refroid.' : 'Remise T°'), 55],
      ['Produit', (r) => r.product, 100],
      ['Lot', (r) => r.lot_number || '', 55],
      ['Début', (r) => `${fmtDateTime(r.start_at)} (${r.start_temp ?? '?'}°)`, 110],
      ['Fin', (r) => `${fmtDateTime(r.end_at)} (${r.end_temp}°)`, 110],
      ['Durée', (r) => `${r.duration_min} min`, 45],
      ['Conf.', (r) => conf(r.compliant), 30],
      ['Opérateur', (r) => r.user_name || '', 55],
    ],
  },
  oil: {
    title: 'Contrôle des huiles de friture',
    sql: `SELECT t.*, u.name AS user_name FROM oil_checks t LEFT JOIN users u ON u.id = t.user_id
          WHERE t.org_id = ? AND t.checked_at >= ? AND t.checked_at < date(?, '+1 day') ORDER BY t.checked_at`,
    columns: [
      ['Date', (r) => fmtDateTime(r.checked_at), 95],
      ['Friteuse', (r) => r.fryer, 100],
      ['% polaires', (r) => r.polar_percent, 60],
      ['Huile changée', (r) => yesNo(r.oil_changed), 70],
      ['Conf.', (r) => conf(r.compliant), 35],
      ['Commentaire', (r) => r.comment || '', 110],
      ['Opérateur', (r) => r.user_name || '', 90],
    ],
  },
  labels: {
    title: 'Traçabilité – étiquettes DLC secondaires',
    sql: `SELECT t.*, u.name AS user_name FROM labels t LEFT JOIN users u ON u.id = t.user_id
          WHERE t.org_id = ? AND t.created_at >= ? AND t.created_at < date(?, '+1 day') ORDER BY t.created_at`,
    columns: [
      ['Produit', (r) => r.product, 130],
      ['Lot', (r) => r.lot_number || '', 70],
      ['Type', (r) => ({ opened: 'Ouverture', prepared: 'Fabrication', defrosted: 'Décongélation' })[r.kind], 75],
      ['Date', (r) => fmtDateTime(r.start_at), 95],
      ['DLC', (r) => fmtDate(r.dlc), 60],
      ['Opérateur', (r) => r.user_name || '', 90],
    ],
  },
  pests: {
    title: 'Plan de lutte contre les nuisibles',
    photoEntity: 'pest_controls',
    caption: (r) => `Nuisibles : ${r.kind}`,
    sql: `SELECT t.*, u.name AS user_name FROM pest_controls t LEFT JOIN users u ON u.id = t.user_id
          WHERE t.org_id = ? AND t.checked_at >= ? AND t.checked_at < date(?, '+1 day') ORDER BY t.checked_at`,
    columns: [
      ['Date', (r) => fmtDateTime(r.checked_at), 95],
      ['Prestataire', (r) => r.provider || '', 100],
      ['Contrôle', (r) => r.kind, 100],
      ['Constat', (r) => r.findings || '', 160],
      ['Conf.', (r) => conf(r.compliant), 35],
      ['Opérateur', (r) => r.user_name || '', 70],
    ],
  },
  nonconformities: {
    title: 'Non-conformités et actions correctives',
    photoEntity: 'non_conformities',
    caption: (r) => `Non-conformité : ${r.description}`,
    sql: `SELECT n.*, u.name AS user_name, c.name AS closer FROM non_conformities n
          LEFT JOIN users u ON u.id = n.created_by LEFT JOIN users c ON c.id = n.closed_by
          WHERE n.org_id = ? AND n.created_at >= ? AND n.created_at < date(?, '+1 day') ORDER BY n.created_at`,
    columns: [
      ['Date', (r) => fmtDateTime(r.created_at), 85],
      ['Description', (r) => r.description, 170],
      ['Action corrective', (r) => r.corrective_action || '', 150],
      ['Statut', (r) => (r.status === 'open' ? 'Ouverte' : 'Clôturée'), 50],
      ['Clôture', (r) => (r.closed_at ? `${fmtDateTime(r.closed_at)} ${r.closer || ''}` : ''), 75],
    ],
  },
};

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function drawTable(doc, rawColumns, rows) {
  const avail = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const total = rawColumns.reduce((s, c) => s + c[2], 0);
  const scale = Math.min(1, avail / total);
  const columns = rawColumns.map(([l, fn, w]) => [l, fn, Math.floor(w * scale)]);
  const left = doc.page.margins.left;
  const bottom = doc.page.height - doc.page.margins.bottom;
  const header = () => {
    let x = left;
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8);
    for (const [label, , w] of columns) {
      doc.text(label, x + 2, y + 3, { width: w - 4 });
      x += w;
    }
    doc.y = y + 16;
    doc.moveTo(left, doc.y - 2).lineTo(x, doc.y - 2).stroke('#999999');
    doc.font('Helvetica').fontSize(8);
  };
  header();
  for (const row of rows) {
    const cells = columns.map(([, fn, w]) => ({ text: String(fn(row) ?? ''), w }));
    const h = Math.max(...cells.map((c) => doc.heightOfString(c.text, { width: c.w - 4 }))) + 6;
    if (doc.y + h > bottom) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    let x = left;
    const nc = row.compliant === 0;
    if (nc) doc.rect(left, y, columns.reduce((s, c) => s + c[2], 0), h).fill('#fde2e2').fillColor('#000000');
    for (const c of cells) {
      doc.text(c.text, x + 2, y + 3, { width: c.w - 4 });
      x += c.w;
    }
    doc.y = y + h;
    doc.moveTo(left, doc.y).lineTo(x, doc.y).stroke('#e0e0e0');
  }
  if (!rows.length) doc.font('Helvetica-Oblique').text('Aucun enregistrement sur la période.', left).font('Helvetica');
}

const ANNEX_MAX = 120;

/** Annexe : les photos des enregistrements de la période, 2 par ligne. */
function drawPhotoAnnex(doc, list) {
  doc.addPage();
  doc.fontSize(14).font('Helvetica-Bold').text('Annexe – Photos');
  doc.fontSize(9).font('Helvetica').fillColor('#555555')
    .text(list.length > ANNEX_MAX ? `${ANNEX_MAX} premières photos sur ${list.length}.` : `${list.length} photo(s).`)
    .fillColor('#000000').moveDown(0.5);
  const left = doc.page.margins.left;
  const colW = (doc.page.width - left - doc.page.margins.right - 16) / 2;
  const imgH = 190;
  const cellH = imgH + 48;
  let col = 0;
  let y = doc.y;
  for (const ph of list.slice(0, ANNEX_MAX)) {
    if (col === 0 && y + cellH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.y;
    }
    const x = left + col * (colW + 16);
    try {
      doc.image(ph.path, x, y, { fit: [colW, imgH], align: 'center', valign: 'center' });
    } catch {
      doc.rect(x, y, colW, imgH).stroke('#cccccc');
      doc.fontSize(8).text('Image indisponible', x, y + imgH / 2, { width: colW, align: 'center' });
    }
    doc.fontSize(8).font('Helvetica-Bold').text(ph.caption || ph.register, x, y + imgH + 4, { width: colW, height: 22, ellipsis: true });
    doc.font('Helvetica').fillColor('#555555').text(`${fmtDateTime(ph.created_at)} – ${ph.register}`, x, y + imgH + 28, { width: colW })
      .fillColor('#000000');
    col = (col + 1) % 2;
    if (col === 0) y += cellH;
  }
}

function mountReports(api, db, photos) {
  function period(req) {
    const to = DATE_RE.test(req.query.to || '') ? req.query.to : new Date().toISOString().slice(0, 10);
    const from = DATE_RE.test(req.query.from || '') ? req.query.from
      : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    return { from, to };
  }

  api.get('/reports/registers', (req, res) => {
    res.json(Object.entries(REGISTERS).map(([key, r]) => ({ key, title: r.title })));
  });

  api.get('/reports/:key.csv', (req, res) => {
    const reg = REGISTERS[req.params.key];
    if (!reg) return res.status(404).json({ error: 'Registre inconnu' });
    const { from, to } = period(req);
    const rows = db.prepare(reg.sql).all(req.user.org_id, from, to);
    const lines = [reg.columns.map((c) => csvEscape(c[0])).join(';')];
    for (const r of rows) lines.push(reg.columns.map((c) => csvEscape(c[1](r))).join(';'));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${req.params.key}_${from}_${to}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  });

  // Classeur HACCP complet (ou un seul registre via ?only=) pour un contrôle sanitaire.
  api.get('/reports/haccp.pdf', (req, res) => {
    const { from, to } = period(req);
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.user.org_id);
    const keys = req.query.only && REGISTERS[req.query.only] ? [req.query.only] : Object.keys(REGISTERS);

    const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true, info: { Title: `Registres HACCP – ${org.name}` } });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="haccp_${from}_${to}.pdf"`);
    doc.pipe(res);

    doc.fontSize(22).font('Helvetica-Bold').text('Registres HACCP', { align: 'center' });
    doc.moveDown(0.5).fontSize(14).font('Helvetica').text(org.name, { align: 'center' });
    if (org.address) doc.fontSize(10).text(org.address, { align: 'center' });
    if (org.siret) doc.fontSize(10).text(`SIRET : ${org.siret}`, { align: 'center' });
    doc.moveDown().fontSize(11).text(`Période du ${fmtDate(from)} au ${fmtDate(to)}`, { align: 'center' });
    doc.text(`Édité le ${fmtDateTime(new Date().toISOString())} par ${req.user.name}`, { align: 'center' });
    doc.moveDown(2).fontSize(10).font('Helvetica-Bold').text('Sommaire');
    doc.font('Helvetica');
    for (const k of keys) {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM (${REGISTERS[k].sql})`).get(req.user.org_id, from, to).n;
      doc.text(`• ${REGISTERS[k].title} : ${n} enregistrement(s)`);
    }
    doc.moveDown().fontSize(8).fillColor('#555555').text(
      `Seuils appliqués : refroidissement à ${rules.COOLING.maxEndTemp} °C max. en ${rules.COOLING.maxMinutes} min ; ` +
      `remise en température à ${rules.REHEATING.minEndTemp} °C min. en ${rules.REHEATING.maxMinutes} min ; ` +
      `huile à ${rules.OIL_MAX_POLAR} % max. de composés polaires. C = conforme, NC = non conforme (lignes surlignées).`
    ).fillColor('#000000');

    const annex = [];
    for (const k of keys) {
      const reg = REGISTERS[k];
      doc.addPage();
      doc.fontSize(14).font('Helvetica-Bold').text(reg.title);
      doc.fontSize(9).font('Helvetica').text(`${org.name} – du ${fmtDate(from)} au ${fmtDate(to)}`).moveDown(0.5);
      const rows = db.prepare(reg.sql).all(req.user.org_id, from, to);
      drawTable(doc, reg.columns, rows);
      if (photos && reg.photoEntity) {
        for (const ph of photos.forReport(req.user.org_id, reg.photoEntity, rows.map((r) => r.id))) {
          annex.push({ ...ph, caption: reg.caption(rows.find((r) => r.id === ph.entity_id)), register: reg.title });
        }
      }
    }
    if (annex.length) drawPhotoAnnex(doc, annex);

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fontSize(7).fillColor('#777777').text(`${org.name} – Registres HACCP – page ${i + 1}/${range.count}`,
        36, doc.page.height - 24, { align: 'center', width: doc.page.width - 72 });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

module.exports = { mountReports, REGISTERS };
