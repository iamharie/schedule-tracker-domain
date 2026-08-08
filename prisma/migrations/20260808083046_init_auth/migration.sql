-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "schedule_tracker";

-- CreateTable
CREATE TABLE "schedule_tracker"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_tracker"."verification_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "schedule_tracker"."users"("email");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_idx" ON "schedule_tracker"."verification_tokens"("user_id");

-- CreateIndex
CREATE INDEX "verification_tokens_token_hash_idx" ON "schedule_tracker"."verification_tokens"("token_hash");

-- AddForeignKey
ALTER TABLE "schedule_tracker"."verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "schedule_tracker"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
