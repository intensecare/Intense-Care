/** Push notification texts and routes — pure (no database). Generic on purpose: no customer, address, Job ID or amount. */

export type PushType = "JOB_ASSIGNED" | "JOB_REASSIGNED" | "JOB_REMINDER" | "QC_PENDING" | "REWORK_ASSIGNED" | "APPROVAL_REQUIRED" | "FOLLOW_UP_DUE" | "NEW_ENQUIRY" | "WHATSAPP_MESSAGE" | "ERP_UPDATE" | "TEST";

export interface PushMessage {
  type: PushType;
  title: string;
  body: string;
  route: string;
}

/** App routes a notification may open. Anything else (external URLs, "//host", "..") is dropped. */
const ROUTE = /^\/(?:|(?:my-jobs|jobs|quality-queue|leads|schedule|contacts|media|device-storage|properties|customers|reviews)(?:\/[A-Za-z0-9_-]{1,64}){0,2})(?:\?[A-Za-z0-9=&_-]{0,80})?$/;
export function safeRoute(route: string | null | undefined): string {
  return route && ROUTE.test(route) && !route.includes("//") && !route.includes("..") ? route : "/";
}

export const messages = {
  jobAssigned: (jobId: string): PushMessage => ({ type: "JOB_ASSIGNED", title: "New job assigned", body: "A job was assigned to you. Tap to view it.", route: `/my-jobs/${jobId}` }),
  jobReassigned: (): PushMessage => ({ type: "JOB_REASSIGNED", title: "Job reassigned", body: "One of your jobs was given to someone else.", route: "/my-jobs" }),
  jobReminder: (jobId: string): PushMessage => ({ type: "JOB_REMINDER", title: "Job starting soon", body: "You have a job coming up. Tap to review it.", route: `/my-jobs/${jobId}` }),
  qcPending: (jobId: string, reinspection = false): PushMessage => ({ type: "QC_PENDING", title: reinspection ? "Reinspection waiting" : "Inspection waiting", body: reinspection ? "Rework is done and ready to be checked again." : "A job is ready for quality check.", route: `/quality-queue/${jobId}` }),
  reworkAssigned: (jobId: string): PushMessage => ({ type: "REWORK_ASSIGNED", title: "Rework needed", body: "QC found items to fix on one of your jobs.", route: `/my-jobs/${jobId}` }),
  approvalRequired: (jobId: string): PushMessage => ({ type: "APPROVAL_REQUIRED", title: "Waiting for customer approval", body: "QC passed. The customer has been asked to approve.", route: `/jobs/${jobId}` }),
  followUps: (count: number): PushMessage => ({ type: "FOLLOW_UP_DUE", title: "Follow-ups due", body: count === 1 ? "You have a lead follow-up due." : `You have ${count} lead follow-ups due.`, route: "/leads" }),
  newEnquiry: (): PushMessage => ({ type: "NEW_ENQUIRY", title: "New WhatsApp enquiry", body: "A new customer wrote to the business WhatsApp.", route: "/leads/inbox" }),
  whatsappMessage: (contactId: string): PushMessage => ({ type: "WHATSAPP_MESSAGE", title: "New WhatsApp message", body: "A customer replied. Tap to open the conversation.", route: `/leads/inbox?c=${contactId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}` }),
  update: (title: string, body: string): PushMessage => ({ type: "ERP_UPDATE", title: title.slice(0, 60), body: body.slice(0, 200), route: "/" }),
  test: (): PushMessage => ({ type: "TEST", title: "Test notification", body: "Notifications are working on this phone.", route: "/device-storage" }),
};

/** A key that is the same for the same event within a window — what makes a repeat a no-op. */
export const bucket = (ms = 10 * 60 * 1000, now = Date.now()) => Math.floor(now / ms);
export const dayKey = (now = Date.now()) => new Date(now + 330 * 60000).toISOString().slice(0, 10);

