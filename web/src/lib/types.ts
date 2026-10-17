export type EntryType = 'sale' | 'purchase' | 'payment' | 'expense';
export type EntrySource = 'voice' | 'text' | 'bill' | 'agent' | 'demo' | 'manual';

export interface Entry {
  id: string;
  type: EntryType;
  ts: number;
  amount: number;
  item?: string;
  qty?: number;
  unit?: string;
  /** Customer for udhaar sales and payments received. */
  customer?: string;
  /** A sale given on udhaar (credit). */
  credit?: boolean;
  /** Supplier for purchases. */
  supplier?: string;
  note?: string;
  source?: EntrySource;
}

/** An entry the AI proposed that the owner has not confirmed yet. */
export type Draft = Omit<Entry, 'id' | 'ts'> & { key: string };

export type Lang = 'en' | 'hi';

export interface Settings {
  shopName: string;
  ownerName: string;
  lang: Lang;
  voiceLang: string;
  model: string;
}

export interface StockItem {
  key: string;
  name: string;
  unit: string;
  qty: number;
  avgCost: number;
  lastPrice: number;
  /** Units sold per day, averaged over the last 14 days. */
  velocity: number;
  daysLeft: number;
  low: boolean;
  /** Restocked most days (milk, bread), so a short shelf life is normal. */
  daily: boolean;
  value: number;
  profit7: number;
  sold7: number;
  lastSoldTs: number;
}

export interface CustomerTxn {
  id: string;
  ts: number;
  kind: 'credit' | 'payment';
  amount: number;
  label: string;
}

export interface Customer {
  key: string;
  name: string;
  due: number;
  phone?: string;
  lastCreditTs: number;
  lastPaymentTs: number;
  history: CustomerTxn[];
}

export interface DaySummary {
  day: string;
  label: string;
  sales: number;
  profit: number;
}

export interface Score {
  value: number;
  band: 'low' | 'mid' | 'high';
  loan: number;
  parts: { label: string; weight: number; value: number }[];
}
