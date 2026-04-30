-- ==============================================================================
-- Abone Surgicals CRM - Corrected Row Level Security (RLS)
-- Run this in your Supabase SQL Editor.
-- ==============================================================================

-- 1. Create SECURITY DEFINER functions to read the profiles table
-- These functions run with admin privileges (bypassing RLS), which prevents 
-- the "infinite recursion" error when we use them inside our policies.

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_user_zone()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT assigned_zone_id FROM public.profiles WHERE id = auth.uid();
$$;

-- 2. Drop the broken policies (if they exist)
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Reps see locations in their zone" ON locations;
DROP POLICY IF EXISTS "Reps see doctors in their zone" ON doctors;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;

-- 3. Re-create the correct RLS Policies using the new functions

-- Profiles: Admins see all, Reps see their own
CREATE POLICY "Admins view all profiles, Reps view own" ON profiles 
    FOR SELECT USING (
        public.get_user_role() = 'admin' OR id = auth.uid()
    );

-- Locations: Admins see all, Reps only see locations matching their assigned_zone_id
CREATE POLICY "Reps see locations in their zone" ON locations
    FOR SELECT USING (
        public.get_user_role() = 'admin' OR zone_id = public.get_user_zone()
    );

-- Doctors: Admins see all, Reps only see doctors who have at least one location in their zone
CREATE POLICY "Reps see doctors in their zone" ON doctors
    FOR SELECT USING (
        public.get_user_role() = 'admin' OR 
        EXISTS (
            SELECT 1 FROM locations 
            WHERE locations.doctor_id = doctors.id 
            AND locations.zone_id = public.get_user_zone()
        )
    );
