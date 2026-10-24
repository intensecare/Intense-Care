-- WhatsApp Business Cloud API: contacts/messages/media/events/templates + integration health. Additive only.
-- CreateTable
CREATE TABLE "WhatsAppIntegration" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "displayPhone" TEXT,
    "verifiedName" TEXT,
    "qualityRating" TEXT,
    "connectionStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckError" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "lastSignatureFailAt" TIMESTAMP(3),
    "lastProcessedAt" TIMESTAMP(3),
    "credentialProblem" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppContact" (
    "id" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "profileName" TEXT,
    "leadId" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "lastPreview" TEXT,
    "lastDirection" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "optedOutAt" TIMESTAMP(3),
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "leadId" TEXT,
    "providerMessageId" TEXT,
    "clientRequestId" TEXT,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "templateName" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "providerTimestamp" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "mediaProviderId" TEXT,
    "mediaMime" TEXT,
    "mediaFilename" TEXT,
    "mediaStatus" TEXT NOT NULL DEFAULT 'NONE',
    "mediaNote" TEXT,
    "mediaAttempts" INTEGER NOT NULL DEFAULT 0,
    "sentBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMedia" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppEvent" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "bodyPreview" TEXT,
    "paramCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppContact_waId_key" ON "WhatsAppContact"("waId");

-- CreateIndex
CREATE INDEX "WhatsAppContact_phoneKey_idx" ON "WhatsAppContact"("phoneKey");

-- CreateIndex
CREATE INDEX "WhatsAppContact_leadId_idx" ON "WhatsAppContact"("leadId");

-- CreateIndex
CREATE INDEX "WhatsAppContact_lastMessageAt_idx" ON "WhatsAppContact"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_providerMessageId_key" ON "WhatsAppMessage"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_clientRequestId_key" ON "WhatsAppMessage"("clientRequestId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_contactId_createdAt_idx" ON "WhatsAppMessage"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_leadId_createdAt_idx" ON "WhatsAppMessage"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_mediaStatus_idx" ON "WhatsAppMessage"("mediaStatus");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMedia_messageId_key" ON "WhatsAppMedia"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppEvent_dedupeKey_key" ON "WhatsAppEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "WhatsAppEvent_state_receivedAt_idx" ON "WhatsAppEvent"("state", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplate_name_language_key" ON "WhatsAppTemplate"("name", "language");

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "WhatsAppContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMedia" ADD CONSTRAINT "WhatsAppMedia_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WhatsAppMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

