-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('TRAINING', 'PROBATION', 'PERMANENT', 'DEPOT_MANAGER');

-- CreateEnum
CREATE TYPE "SalaryType" AS ENUM ('DAILY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'RESIGNED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "PayrollItemKind" AS ENUM ('BASE', 'BONUS', 'DEDUCTION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BonusType" AS ENUM ('ATTENDANCE', 'PERFORMANCE', 'SALES', 'DEPOT', 'MANUAL');

-- CreateEnum
CREATE TYPE "DeductionType" AS ENUM ('LATE', 'ABSENCE', 'MANUAL', 'CASH_ADVANCE', 'OTHER');

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "authSubjectId" UUID,
    "fullName" TEXT NOT NULL,
    "photoUrl" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "depotId" UUID NOT NULL,
    "position" TEXT NOT NULL,
    "employmentStatus" "EmploymentStatus" NOT NULL,
    "joinDate" DATE NOT NULL,
    "salaryType" "SalaryType" NOT NULL,
    "dailyRate" DECIMAL(12,2),
    "monthlyRate" DECIMAL(12,2),
    "bankName" TEXT,
    "bankAccount" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" UUID,
    "updatedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_history" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "changeType" TEXT NOT NULL,
    "fromValue" JSONB,
    "toValue" JSONB,
    "effectiveDate" DATE NOT NULL,
    "note" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "face_embeddings" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "vector" DOUBLE PRECISION[],
    "quality" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourcePhotoUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "face_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "checkInPhotoUrl" TEXT,
    "checkOutPhotoUrl" TEXT,
    "checkInScore" DOUBLE PRECISION,
    "checkOutScore" DOUBLE PRECISION,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "workingMinutes" INTEGER,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'ABSENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_adjustments" (
    "id" UUID NOT NULL,
    "attendanceId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "approvedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "depotId" UUID,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "depotId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payrolls" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "gross" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalBonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "presentDays" INTEGER NOT NULL DEFAULT 0,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" UUID NOT NULL,
    "payrollId" UUID NOT NULL,
    "kind" "PayrollItemKind" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonuses" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "BonusType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "note" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bonuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deductions" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "DeductionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "note" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_reviews" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "reviewerId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_settings" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "depotId" UUID,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_employeeCode_key" ON "employees"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "employees_authSubjectId_key" ON "employees"("authSubjectId");

-- CreateIndex
CREATE INDEX "employees_depotId_idx" ON "employees"("depotId");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "employment_history_employeeId_idx" ON "employment_history"("employeeId");

-- CreateIndex
CREATE INDEX "face_embeddings_employeeId_idx" ON "face_embeddings"("employeeId");

-- CreateIndex
CREATE INDEX "face_embeddings_active_idx" ON "face_embeddings"("active");

-- CreateIndex
CREATE INDEX "attendance_depotId_workDate_idx" ON "attendance"("depotId", "workDate");

-- CreateIndex
CREATE INDEX "attendance_workDate_idx" ON "attendance"("workDate");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_employeeId_workDate_key" ON "attendance"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "attendance_adjustments_attendanceId_idx" ON "attendance_adjustments"("attendanceId");

-- CreateIndex
CREATE INDEX "shifts_depotId_idx" ON "shifts"("depotId");

-- CreateIndex
CREATE INDEX "holidays_date_idx" ON "holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_depotId_key" ON "holidays"("date", "depotId");

-- CreateIndex
CREATE INDEX "payrolls_periodMonth_status_idx" ON "payrolls"("periodMonth", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payrolls_employeeId_periodMonth_key" ON "payrolls"("employeeId", "periodMonth");

-- CreateIndex
CREATE INDEX "payroll_items_payrollId_idx" ON "payroll_items"("payrollId");

-- CreateIndex
CREATE INDEX "bonuses_employeeId_periodMonth_idx" ON "bonuses"("employeeId", "periodMonth");

-- CreateIndex
CREATE INDEX "deductions_employeeId_periodMonth_idx" ON "deductions"("employeeId", "periodMonth");

-- CreateIndex
CREATE INDEX "performance_reviews_employeeId_idx" ON "performance_reviews"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "performance_reviews_employeeId_periodMonth_key" ON "performance_reviews"("employeeId", "periodMonth");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at");

-- CreateIndex
CREATE INDEX "service_settings_scope_depotId_idx" ON "service_settings"("scope", "depotId");

-- AddForeignKey
ALTER TABLE "employment_history" ADD CONSTRAINT "employment_history_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_embeddings" ADD CONSTRAINT "face_embeddings_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "attendance_adjustments_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payrolls" ADD CONSTRAINT "payrolls_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "payrolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonuses" ADD CONSTRAINT "bonuses_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deductions" ADD CONSTRAINT "deductions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

