export type ComplaintStatus = "new" | "in_review" | "answered" | "closed";
export type ComplaintKind = "product" | "delivery" | "payment" | "service" | "other";
export type ComplaintFilter = "open" | "all" | "answered" | "closed";

export interface ComplaintRow {
  id: string;
  number: string;
  createdAt: string;
  kind: ComplaintKind;
  status: ComplaintStatus;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  orderNumber: string | null;
  detail: string;
  response: string | null;
  dueAt: string;
  answeredAt: string | null;
  overdue: boolean;
  hasAccount: boolean;
}

export interface ComplaintPage {
  rows: ComplaintRow[];
  total: number;
}

export interface ComplaintSummary {
  new: number;
  inReview: number;
  overdue: number;
  total: number;
}

export const PAGE_SIZE = 50;
