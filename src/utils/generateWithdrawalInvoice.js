import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

// ─── Brand palette ────────────────────────────────────────────────────────────
const C = {
  orange:       '#FF6B00',
  orangeLight:  '#FFF3E8',
  dark:         '#1A1A2E',
  mid:          '#4A4A6A',
  lightGray:    '#F7F7F7',
  borderGray:   '#E0E0E0',
  white:        '#FFFFFF',
  green:        '#27AE60',
  greenLight:   '#EAFAF1',
  accent:       '#AAAACC',
};

function statusColors(status = '') {
  switch (status.toLowerCase()) {
    case 'approved': return { stroke: C.green,   fill: C.greenLight };
    case 'pending':  return { stroke: '#F39C12',  fill: '#FEF9E7' };
    default:         return { stroke: '#E74C3C',  fill: '#FDEDEC' };
  }
}

// ─── Tiny layout helpers ──────────────────────────────────────────────────────
function hline(doc, y, x1 = 50, x2 = 545, color = C.borderGray, w = 0.5) {
  doc.save().moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(w).stroke().restore();
}

function roundRect(doc, x, y, w, h, r = 6, opts = {}) {
  doc.save();
  doc.roundedRect(x, y, w, h, r);
  if (opts.fill && opts.stroke) {
    doc.fillColor(opts.fill).strokeColor(opts.stroke).lineWidth(opts.lw || 0.8).fillAndStroke();
  } else if (opts.fill) {
    doc.fillColor(opts.fill).fill();
  } else if (opts.stroke) {
    doc.strokeColor(opts.stroke).lineWidth(opts.lw || 0.8).stroke();
  }
  doc.restore();
}

function labelValue(doc, lx, vx, y, label, value, opts = {}) {
  doc.save()
    .font('Helvetica').fontSize(opts.lSize || 7).fillColor(opts.lColor || C.mid)
    .text(label.toUpperCase(), lx, y, { lineBreak: false });
  doc
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(opts.vSize || 9)
    .fillColor(opts.vColor || C.dark)
    .text(String(value ?? 'N/A'), vx, y, { lineBreak: false });
  doc.restore();
}

// ─── Main generator ───────────────────────────────────────────────────────────
export const generateWithdrawalInvoice = (withdrawal, provider) => {
  return new Promise((resolve, reject) => {
    try {
      const dirPath = path.join(process.cwd(), 'public/uploads/invoices');
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

      const fileName = `invoice-${withdrawal._id}.pdf`;
      const filePath = path.join(dirPath, fileName);

      const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Invoice ${withdrawal._id}` } });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      const ML = 50, MR = 545, CW = MR - ML;
      const PAGE_H = 841;

      /* ── HEADER BAND ─────────────────────────────────────────────────── */
      const HDR_H = 165;
      doc.save().rect(0, 0, 595, HDR_H).fill(C.dark).restore();

      // Diagonal accent stripe
      doc.save()
        .polygon([345, 0], [430, 0], [360, HDR_H], [275, HDR_H])
        .fill(C.orange)
        .restore();

      // Logo
      const logoPath = path.join(process.cwd(), 'public/logo.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, ML, 28, { width: 52, height: 52 });
      }

      // Brand name
      doc.save()
        .font('Helvetica-Bold').fontSize(26).fillColor(C.white)
        .text('KAJ', ML + 60, 34, { lineBreak: false })
        .fillColor(C.orange)
        .text('NOW', ML + 60 + 44, 34, { lineBreak: false })
        .font('Helvetica').fontSize(8).fillColor(C.accent)
        .text('Smart Service Platform', ML + 60, 66)
        .restore();

      // Invoice title (right)
      doc.save()
        .font('Helvetica-Bold').fontSize(20).fillColor(C.white)
        .text('WITHDRAWAL', 0, 34, { align: 'right', width: MR, lineBreak: false });
      doc
        .fillColor(C.orange)
        .text('INVOICE', 0, 60, { align: 'right', width: MR, lineBreak: false });

      const invId  = String(withdrawal._id ?? '');
      const invShort = invId.length > 10 ? invId.slice(-10).toUpperCase() : invId.toUpperCase();
      const dateStr  = new Date().toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });

      doc.save()
        .font('Helvetica').fontSize(8).fillColor(C.accent)
        .text(`#${invShort}`, 0, 98, { align: 'right', width: MR, lineBreak: false });
      doc
        .text(dateStr, 0, 112, { align: 'right', width: MR, lineBreak: false });
      doc.restore();

      /* ── STATUS BADGE ─────────────────────────────────────────────────── */
      const sc = statusColors(withdrawal.status);
      const BY = HDR_H + 14, BW = 110, BH = 22;
      roundRect(doc, ML, BY, BW, BH, 11, { fill: sc.fill, stroke: sc.stroke, lw: 1.2 });
      doc.save()
        .font('Helvetica-Bold').fontSize(8.5).fillColor(sc.stroke)
        .text(`● ${(withdrawal.status || 'PENDING').toUpperCase()}`, ML, BY + 7, { width: BW, align: 'center', lineBreak: false })
        .restore();

      /* ── INFO CARD ────────────────────────────────────────────────────── */
      const IC_Y = BY + BH + 10, IC_H = 100;
      roundRect(doc, ML, IC_Y, CW, IC_H, 6, { fill: C.lightGray, stroke: C.borderGray, lw: 0.5 });

      const col2 = ML + CW * 0.5 + 10;
      labelValue(doc, ML + 14, ML + 122, IC_Y + 14,  'Withdrawal ID', withdrawal._id,                          { bold: true, vSize: 8 });
      labelValue(doc, ML + 14, ML + 122, IC_Y + 40,  'Provider',      provider?.userId?.name,                  { bold: true });
      labelValue(doc, ML + 14, ML + 122, IC_Y + 66,  'Email',         provider?.userId?.email);

      // divider
      doc.save().moveTo(ML + CW * 0.5, IC_Y + 12).lineTo(ML + CW * 0.5, IC_Y + IC_H - 12)
        .strokeColor(C.borderGray).lineWidth(0.5).stroke().restore();

      labelValue(doc, col2, col2 + 68, IC_Y + 14, 'Date Issued',    new Date().toLocaleDateString('en-PK', { dateStyle: 'medium' }));
      labelValue(doc, col2, col2 + 68, IC_Y + 40, 'Transaction ID', withdrawal.transactionId || 'N/A');
      labelValue(doc, col2, col2 + 68, IC_Y + 66, 'Status',         withdrawal.status || 'N/A', { vColor: sc.stroke, bold: true });

      /* ── AMOUNT HIGHLIGHT ─────────────────────────────────────────────── */
      const AM_Y = IC_Y + IC_H + 12, AM_H = 70;
      roundRect(doc, ML, AM_Y, CW, AM_H, 6, { fill: C.orangeLight, stroke: C.orange, lw: 1.5 });

      doc.save()
        .font('Helvetica').fontSize(8).fillColor(C.orange)
        .text('REQUESTED AMOUNT', ML + 16, AM_Y + 12, { lineBreak: false });

      const amtDisplay = typeof withdrawal.requestedAmount === 'number'
        ? `PKR ${withdrawal.requestedAmount.toLocaleString()}`
        : `PKR ${withdrawal.requestedAmount ?? '0'}`;

      doc
        .font('Helvetica-Bold').fontSize(28).fillColor(C.orange)
        .text(amtDisplay, ML + 16, AM_Y + 28, { lineBreak: false });

      doc.restore();

      /* ── PAYMENT + BANK SIDE-BY-SIDE CARDS ──────────────────────────── */
      const SEC_Y = AM_Y + AM_H + 14, SEC_H = 128, SEC_W = (CW - 14) / 2;

      // Payment card
      const PX = ML;
      roundRect(doc, PX, SEC_Y, SEC_W, SEC_H, 6, { fill: C.white, stroke: C.borderGray, lw: 0.5 });
      roundRect(doc, PX, SEC_Y, SEC_W, 26, 6, { fill: C.dark });
      doc.save().font('Helvetica-Bold').fontSize(8.5).fillColor(C.white)
        .text('PAYMENT DETAILS', PX + 10, SEC_Y + 9, { lineBreak: false }).restore();

      const pl = PX + 10, pv = PX + SEC_W * 0.48;
      labelValue(doc, pl, pv, SEC_Y + 38, 'Amount',      amtDisplay,                      { bold: true, vColor: C.orange });
      labelValue(doc, pl, pv, SEC_Y + 64, 'Transaction', withdrawal.transactionId || 'N/A');
      labelValue(doc, pl, pv, SEC_Y + 90, 'Status',      withdrawal.status || 'N/A',       { vColor: sc.stroke, bold: true });

      // Bank card
      const BX2 = ML + SEC_W + 14;
      roundRect(doc, BX2, SEC_Y, SEC_W, SEC_H, 6, { fill: C.white, stroke: C.borderGray, lw: 0.5 });
      roundRect(doc, BX2, SEC_Y, SEC_W, 26, 6, { fill: C.dark });
      doc.save().font('Helvetica-Bold').fontSize(8.5).fillColor(C.white)
        .text('BANK DETAILS', BX2 + 10, SEC_Y + 9, { lineBreak: false }).restore();

      const bd = withdrawal.bankDetails ?? {};
      const bl = BX2 + 10, bv = BX2 + SEC_W * 0.44;
      labelValue(doc, bl, bv, SEC_Y + 38, 'Bank Name',   bd.bankName      || 'N/A', { bold: true });
      labelValue(doc, bl, bv, SEC_Y + 64, 'Acc. Title',  bd.accountTitle  || 'N/A');
      labelValue(doc, bl, bv, SEC_Y + 90, 'Acc. Number', bd.accountNumber || 'N/A');
      labelValue(doc, bl, bv, SEC_Y + 116,'Branch Code', bd.branchCode    || 'N/A');

      /* ── APPROVAL NOTE ────────────────────────────────────────────────── */
      const NT_Y = SEC_Y + SEC_H + 14, NT_H = 50;
      roundRect(doc, ML, NT_Y, CW, NT_H, 5, { fill: C.greenLight, stroke: C.green, lw: 0.8 });

      doc.save()
        .font('Helvetica-Bold').fontSize(9).fillColor(C.green)
        .text('✓  Approved & Processed by KajNow Admin', ML + 14, NT_Y + 10);
      doc.restore();

      doc.end();

      stream.on('finish', () => resolve({ filePath, fileName, url: `/uploads/invoices/${fileName}` }));
      stream.on('error', reject);

    } catch (err) {
      reject(err);
    }
  });
};