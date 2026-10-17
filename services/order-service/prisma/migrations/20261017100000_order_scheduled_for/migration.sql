-- FR-036: the real instant a scheduled delivery window starts (the free-form label never said which day).
ALTER TABLE "orders" ADD COLUMN "scheduledFor" TIMESTAMP(3);
