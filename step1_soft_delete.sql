-- Phase 6: Activity Logging & Lead Lifecycle
-- Step 1: Soft Delete (is_active flag)

ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
