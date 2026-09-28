/**
 * Shared contract for the server-resolved customer handover payload
 * (GET /api/portal/[token]) and its sign-off response
 * (POST /api/portal/[token]/sign).
 */

export interface PortalHandover {
  job: {
    id: string;
    status: string;
    /** Company-authored service package name (from the DB). */
    serviceName: string | null;
    scheduledDate: string;
    scheduledTimeSlot: string;
  };
  customer: { name: string; phoneMasked: string } | null;
  property: { title: string; address: string } | null;
  qualityCheck: {
    score: number;
    decision: string;
    inspectorId: string;
    createdAt: string;
  } | null;
  invite: {
    signStatus: "PENDING" | "APPROVED" | "ATTENTION_REQUESTED";
    signedAt: string | null;
    signatoryName: string | null;
    smsStatus: string;
    createdAt: string;
  };
  /** Evidence photos resolved server-side from the database (Cloudinary URLs). */
  photos: {
    id: string;
    area: string;
    photoType: "before" | "after";
    photoUrl: string;
    thumbnailUrl?: string | null;
    caption?: string | null;
    uploadedAt: string;
  }[];
  checklist: {
    id: string;
    area: string;
    task: string;
    completed: boolean;
  }[];
}

export interface PortalSignResponse {
  success: boolean;
  error?: string;
  data?: {
    signStatus: string;
    signedAt: string | null;
    alreadySigned: boolean;
    jobStatus: string;
  };
}
