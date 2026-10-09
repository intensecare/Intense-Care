/**
 * Lead Management — shared definitions (used by the server and the app).
 */

export const LEAD_SOURCES = ["PHONE_CALL", "GOOGLE_SEARCH", "GOOGLE_MAPS", "GOOGLE_ADS", "WEBSITE", "WHATSAPP", "REFERRAL", "WALK_IN", "OTHER"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  PHONE_CALL: "Phone Call",
  GOOGLE_SEARCH: "Google Search",
  GOOGLE_MAPS: "Google Maps",
  GOOGLE_ADS: "Google Ads",
  WEBSITE: "Website",
  WHATSAPP: "WhatsApp",
  REFERRAL: "Referral",
  WALK_IN: "Walk-in",
  OTHER: "Other",
};

export const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "QUOTATION_SENT", "FOLLOW_UP", "WON", "LOST"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  QUOTATION_SENT: "Quotation sent",
  FOLLOW_UP: "Follow-up",
  WON: "Won",
  LOST: "Lost",
};
export const LEAD_STATUS_TONE: Record<LeadStatus, "neutral" | "info" | "good" | "warn" | "bad" | "violet"> = {
  NEW: "info",
  CONTACTED: "neutral",
  QUALIFIED: "violet",
  QUOTATION_SENT: "warn",
  FOLLOW_UP: "warn",
  WON: "good",
  LOST: "bad",
};
export const OPEN_LEAD_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "QUOTATION_SENT", "FOLLOW_UP"];
export const isClosedLead = (s: string) => s === "WON" || s === "LOST";

export const CALL_OUTCOMES = ["INTERESTED", "CALL_BACK", "QUOTE_REQUESTED", "BOOKED", "NOT_INTERESTED", "NO_ANSWER", "WRONG_NUMBER", "ENQUIRY_ONLY"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = {
  INTERESTED: "Interested",
  CALL_BACK: "Asked to call back",
  QUOTE_REQUESTED: "Wants a quotation",
  BOOKED: "Ready to book",
  NOT_INTERESTED: "Not interested",
  NO_ANSWER: "No answer",
  WRONG_NUMBER: "Wrong number / spam",
  ENQUIRY_ONLY: "Just an enquiry",
};

export const LOST_REASONS = ["Price too high", "Chose a competitor", "Not reachable", "Service not offered", "Area not served", "Postponed / no longer needed", "Duplicate / spam", "Other"] as const;

/** Last 10 digits — "+91 98450 12345", "098450-12345" and "9845012345" are the same person. */
export function phoneKey(phone: string): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}
/** A real-looking phone number: 10–15 digits after removing spaces, +, - and brackets. */
export function isPlausiblePhone(phone: string): boolean {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 && d.length <= 15 && !/^(\d)\1+$/.test(d);
}

export interface Attribution {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  gclid?: string | null;
  referrerUrl?: string | null;
}

/**
 * The source of a website enquiry, from what the browser actually told us
 * (UTM tags, Google Ads click id, referrer). Never guessed beyond that: an
 * enquiry with nothing to go on is simply WEBSITE.
 */
export function attributeWebsiteLead(a: Attribution): { source: LeadSource; details: string } {
  const src = (a.utmSource ?? "").toLowerCase();
  const med = (a.utmMedium ?? "").toLowerCase();
  const campaign = a.utmCampaign ? ` · campaign "${a.utmCampaign}"` : "";
  if (a.gclid || (src.includes("google") && /^(cpc|ppc|paid|paidsearch|sem)$/.test(med))) {
    return { source: "GOOGLE_ADS", details: `Website form via Google Ads${a.gclid ? " (click id recorded)" : ""}${campaign}` };
  }
  if (/(gmb|google_business|googlebusiness|google_maps|maps)/.test(src) || /(gmb|maps|local)/.test(med)) {
    return { source: "GOOGLE_MAPS", details: `Website form via the Google Business Profile / Maps link${campaign}` };
  }
  if (src.includes("google") && (med === "organic" || med === "")) {
    return { source: "GOOGLE_SEARCH", details: `Website form via Google (utm_source=${a.utmSource})${campaign}` };
  }
  if (src.includes("whatsapp")) return { source: "WHATSAPP", details: `Website form via a WhatsApp link${campaign}` };
  if (/(referral|refer)/.test(src) || med === "referral") return { source: "REFERRAL", details: `Website form via a referral link${campaign}` };
  let ref = "";
  try {
    if (a.referrerUrl) {
      const host = new URL(a.referrerUrl).hostname.replace(/^www\./, "");
      if (/^google\./.test(host)) return { source: "GOOGLE_SEARCH", details: `Website form; visitor arrived from ${host}${campaign}` };
      ref = ` · referrer ${host}`;
    }
  } catch {
    /* not a URL */
  }
  return { source: "WEBSITE", details: `Website enquiry form${src ? ` (utm_source=${a.utmSource}${med ? `, utm_medium=${a.utmMedium}` : ""})` : ""}${campaign}${ref}` };
}

/** Today in India (YYYY-MM-DD), the business's calendar for follow-ups. */
export const todayIST = (now = Date.now()) => new Date(now + 330 * 60 * 1000).toISOString().slice(0, 10);

export interface LeadRow {
  id: string;
  leadNumber: string;
  customerName: string;
  phone: string;
  email: string | null;
  source: LeadSource;
  sourceDetails: string | null;
  serviceInterest: string | null;
  serviceId: string | null;
  serviceName?: string | null;
  propertyAddress: string | null;
  locality: string | null;
  city: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  preferredDate: string | null;
  estimatedValue: number | null;
  assignedUserId: string | null;
  assignedUserName?: string | null;
  status: LeadStatus;
  lostReason: string | null;
  notes: string | null;
  nextFollowUpDate: string | null;
  lastContactedAt: string | null;
  quoteId: string | null;
  quoteNumber?: string | null;
  convertedCustomerId: string | null;
  convertedPropertyId: string | null;
  convertedJobId: string | null;
  convertedJobNumber?: string | null;
  convertedAt: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  gclid: string | null;
  landingPage: string | null;
  referrerUrl: string | null;
  createdAt: string;
  updatedAt: string;
  /** Other open leads with the same phone (duplicate warning). */
  duplicates?: { id: string; leadNumber: string; status: LeadStatus }[];
}

export interface LeadActivityRow {
  id: string;
  type: string;
  message: string;
  outcome: string | null;
  actorName: string;
  createdAt: string;
}

export interface LeadStats {
  total: number;
  new: number;
  bySource: Record<LeadSource, number>;
  byStatus: Record<LeadStatus, number>;
  followUpsToday: number;
  overdueFollowUps: number;
  quotationsSent: number;
  won: number;
  lost: number;
  /** won / (won + lost), 0–100; null when nothing is closed yet. */
  conversionRate: number | null;
  /** Sum of estimated value of open leads. */
  pipelineValue: number;
}
