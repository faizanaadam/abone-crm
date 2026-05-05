-- Phase 6: Activity Logging & Lead Lifecycle
-- Step 2: Visit Logging Table

CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
    rep_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    visit_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT,
    outcome TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast querying by doctor or rep
CREATE INDEX IF NOT EXISTS idx_activity_logs_doctor_id ON public.activity_logs(doctor_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_rep_id ON public.activity_logs(rep_id);

-- ==========================================
-- ROW LEVEL SECURITY (RLS)
-- ==========================================
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 1. Reps can insert their own logs
CREATE POLICY "Reps can insert their own logs" 
ON public.activity_logs 
FOR INSERT 
WITH CHECK (auth.uid() = rep_id);

-- 2. Anyone who can see the doctor can see the logs
-- (This elegantly piggybacks on the doctors table RLS zone lockdown!)
CREATE POLICY "Users can view logs for visible doctors"
ON public.activity_logs
FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.doctors WHERE id = activity_logs.doctor_id
    )
);

-- 3. Admins have full control
CREATE POLICY "Admins have full access to logs"
ON public.activity_logs
FOR ALL
USING (public.get_user_role() = 'admin');
