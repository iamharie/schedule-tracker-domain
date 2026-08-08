-- CreateEnum
CREATE TYPE "schedule_tracker"."Priority" AS ENUM ('HIGH', 'MEDIUM', 'NICE_TO_DO');

-- CreateTable
CREATE TABLE "schedule_tracker"."calendars" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#4F46E5',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_tracker"."events" (
    "id" TEXT NOT NULL,
    "calendar_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "location" TEXT,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "priority" "schedule_tracker"."Priority" NOT NULL DEFAULT 'MEDIUM',
    "is_anchored" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" TEXT NOT NULL,
    "rrule" TEXT,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_tracker"."event_exceptions" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "original_date" TIMESTAMPTZ NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "notes" TEXT,
    "location" TEXT,
    "starts_at" TIMESTAMPTZ,
    "duration_minutes" INTEGER,
    "priority" "schedule_tracker"."Priority",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendars_user_id_idx" ON "schedule_tracker"."calendars"("user_id");

-- CreateIndex
CREATE INDEX "events_calendar_id_starts_at_idx" ON "schedule_tracker"."events"("calendar_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_exceptions_event_id_original_date_key" ON "schedule_tracker"."event_exceptions"("event_id", "original_date");

-- AddForeignKey
ALTER TABLE "schedule_tracker"."calendars" ADD CONSTRAINT "calendars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "schedule_tracker"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_tracker"."events" ADD CONSTRAINT "events_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "schedule_tracker"."calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_tracker"."event_exceptions" ADD CONSTRAINT "event_exceptions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "schedule_tracker"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
