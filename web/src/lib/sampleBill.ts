import { uid } from './ledger';
import type { Draft } from './types';

export const SAMPLE_SUPPLIER = 'Agarwal Traders';

const LINES: [string, number, string, number, number][] = [
  ['Toor Dal', 10, 'kg', 118, 1180],
  ['Mustard Oil (Sarson)', 12, 'L', 138, 1656],
  ['Tea (Chai Patti)', 5, 'kg', 355, 1775],
  ['Detergent Powder', 10, 'kg', 88, 880],
  ['Glucose Biscuits', 60, 'pkt', 10, 600],
  ['Bath Soap', 24, 'pc', 30, 720],
];

/** Draws a wholesaler bill on a canvas, slightly rotated like a phone photo. */
export function drawSampleBill(): string {
  const W = 1100;
  const H = 1300;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5b4a3a';
  g.fillRect(0, 0, W, H);
  g.save();
  g.translate(W / 2, H / 2);
  g.rotate(-0.012);
  g.translate(-W / 2, -H / 2);
  g.fillStyle = '#fbf8f1';
  g.shadowColor = 'rgba(0,0,0,.35)';
  g.shadowBlur = 30;
  g.fillRect(70, 60, W - 140, H - 120);
  g.shadowBlur = 0;

  const ink = '#1f2a44';
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.font = 'bold 44px Georgia, serif';
  g.fillText('AGARWAL TRADERS', W / 2, 150);
  g.font = '22px Georgia, serif';
  g.fillText('Wholesale Grocery · Station Road, Sitapur', W / 2, 188);
  g.fillText('GSTIN 09ABCPA1234F1Z5 · Ph 98390 12345', W / 2, 218);
  g.font = 'bold 26px Georgia, serif';
  g.fillText('TAX INVOICE', W / 2, 272);

  g.textAlign = 'left';
  g.font = '22px Georgia, serif';
  const d = new Date();
  g.fillText(`Bill No. 2417`, 110, 320);
  g.textAlign = 'right';
  g.fillText(`Date ${d.toLocaleDateString('en-IN')}`, W - 110, 320);
  g.textAlign = 'left';
  g.fillText('To: Sharma Kirana Store', 110, 354);

  const cols = [120, 470, 640, 790, W - 120];
  g.strokeStyle = ink;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(100, 380);
  g.lineTo(W - 100, 380);
  g.moveTo(100, 425);
  g.lineTo(W - 100, 425);
  g.stroke();
  g.font = 'bold 22px Georgia, serif';
  g.fillText('Item', cols[0], 410);
  g.textAlign = 'right';
  g.fillText('Qty', cols[2] - 10, 410);
  g.fillText('Rate', cols[3] - 10, 410);
  g.fillText('Amount', cols[4], 410);

  g.font = 'bold 27px Menlo, "DejaVu Sans Mono", monospace';
  let y = 470;
  let total = 0;
  for (const [name, qty, unit, rate, amt] of LINES) {
    g.textAlign = 'left';
    g.fillText(name, cols[0], y);
    g.textAlign = 'right';
    g.fillText(`${qty} ${unit}`, cols[2] - 10, y);
    g.fillText(String(rate), cols[3] - 10, y);
    g.fillText(amt.toFixed(2), cols[4], y);
    total += amt;
    y += 52;
  }
  g.beginPath();
  g.moveTo(100, y - 20);
  g.lineTo(W - 100, y - 20);
  g.stroke();
  g.font = 'bold 28px Georgia, serif';
  g.textAlign = 'left';
  g.fillText('Grand Total', cols[0], y + 22);
  g.textAlign = 'right';
  g.fillText(`₹ ${total.toLocaleString('en-IN')}.00`, cols[4], y + 22);
  g.font = 'italic 22px Georgia, serif';
  g.textAlign = 'left';
  g.fillText('Six thousand eight hundred eleven only', cols[0], y + 70);

  g.font = 'italic 34px "Brush Script MT", cursive';
  g.textAlign = 'right';
  g.fillText('for Agarwal Traders', W - 120, H - 150);
  g.restore();
  return c.toDataURL('image/jpeg', 0.95);
}

/** What the sample bill contains, used when Gemini can't be reached. */
export function sampleBillDrafts(): Draft[] {
  const names = ['Toor Dal', 'Mustard Oil', 'Tea', 'Detergent', 'Biscuits', 'Soap'];
  return LINES.map(([, qty, unit, , amt], i) => ({ key: uid(), type: 'purchase', item: names[i], qty, unit, amount: amt, supplier: SAMPLE_SUPPLIER }));
}
