-- ==============================================================================
-- Abone Surgicals CRM - Exclusive Doctor Ownership Migration
-- Run this in your Supabase SQL Editor first.
-- ==============================================================================

-- 1. Add assigned_rep_id column to public.doctors table
ALTER TABLE public.doctors 
ADD COLUMN IF NOT EXISTS assigned_rep_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Create an index on the new column for performance
CREATE INDEX IF NOT EXISTS idx_doctors_assigned_rep_id ON public.doctors(assigned_rep_id);

-- 2. Drop existing SELECT policies on doctors and locations
DROP POLICY IF EXISTS "Reps see doctors in their zone" ON public.doctors;
DROP POLICY IF EXISTS "Reps see locations in their zone" ON public.locations;

-- 3. Create the new exclusive-aware SELECT policies
CREATE POLICY "Reps see doctors in their zone or assigned to them" ON public.doctors
    FOR SELECT USING (
        public.get_user_role() = 'admin' OR 
        assigned_rep_id = auth.uid() OR
        (
            assigned_rep_id IS NULL AND 
            EXISTS (
                SELECT 1 FROM public.locations 
                WHERE locations.doctor_id = doctors.id 
                AND locations.zone_id = public.get_user_zone()
            )
        )
    );

CREATE POLICY "Reps see locations in their zone or assigned to them" ON public.locations
    FOR SELECT USING (
        public.get_user_role() = 'admin' OR 
        EXISTS (
            SELECT 1 FROM public.doctors
            WHERE doctors.id = locations.doctor_id
            AND doctors.assigned_rep_id = auth.uid()
        ) OR
        (
            zone_id = public.get_user_zone() AND
            EXISTS (
                SELECT 1 FROM public.doctors
                WHERE doctors.id = locations.doctor_id
                AND doctors.assigned_rep_id IS NULL
            )
        )
    );
