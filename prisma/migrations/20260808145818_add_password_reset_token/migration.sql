-- CreateTable
CREATE TABLE "schedule_tracker"."password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "schedule_tracker"."password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_hash_idx" ON "schedule_tracker"."password_reset_tokens"("token_hash");

-- AddForeignKey
ALTER TABLE "schedule_tracker"."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "schedule_tracker"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
