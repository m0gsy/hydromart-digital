-- Browser Web Push subscriptions (RFC 8291). One row per device endpoint.
CREATE TABLE "web_push_subscriptions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key" ON "web_push_subscriptions"("endpoint");
CREATE INDEX "web_push_subscriptions_customerId_idx" ON "web_push_subscriptions"("customerId");
