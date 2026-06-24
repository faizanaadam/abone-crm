-- ==============================================================================
-- Fix: Break circular RLS dependency between doctors <-> locations
-- The locations policy was referencing doctors (which has RLS referencing locations).
-- Solution: Use a SECURITY DEFINER function to bypass RLS when checking doctor ownership.
-- ==============================================================================

-- 1. Create a SECURITY DEFINER function to check doctor assignment without RLS
CREATE OR REPLACE FUNCTION public.get_doctor_assigned_rep(p_doctor_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT assigned_rep_id FROM public.doctors WHERE id = p_doctor_id;
$$;

-- 2. Drop the broken locations policy
DROP POLICY IF EXISTS "Reps see locations in their zone or assigned to them" ON public.locations;

-- 3. Recreate locations policy using the SECURITY DEFINER function (no circular ref)
CREATE POLICY "Reps see locations in their zone or assigned to them" ON public.locations
    FOR SELECT USING (
        public.get_user_role() = 'admin' OR 
        public.get_doctor_assigned_rep(doctor_id) = auth.uid() OR
        (
            zone_id = public.get_user_zone() AND
            public.get_doctor_assigned_rep(doctor_id) IS NULL
        )
    );
