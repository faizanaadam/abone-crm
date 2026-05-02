-- 1. Remove the temporary "public read access" policies we set up earlier. 
-- This is the crucial step that actually "locks the doors".
DROP POLICY IF EXISTS "Enable public read access for doctors" ON public.doctors;
DROP POLICY IF EXISTS "Enable public read access for locations" ON public.locations;

-- 2. Enforce Zone-Based Access on Locations
-- Admins see all, Reps see only where the location's zone_id matches their assigned_zone_id
DROP POLICY IF EXISTS "Reps see locations in their zone" ON public.locations;
CREATE POLICY "Reps see locations in their zone" 
ON public.locations 
FOR SELECT 
USING (
    public.get_user_role() = 'admin' OR 
    zone_id = (SELECT assigned_zone_id FROM public.profiles WHERE id = auth.uid())
);

-- 3. Enforce Zone-Based Access on Doctors
-- Admins see all, Reps see only doctors who have at least ONE location in their assigned_zone_id
DROP POLICY IF EXISTS "Reps see doctors in their zone" ON public.doctors;
CREATE POLICY "Reps see doctors in their zone" 
ON public.doctors 
FOR SELECT 
USING (
    public.get_user_role() = 'admin' OR 
    EXISTS (
        SELECT 1 FROM public.locations 
        WHERE locations.doctor_id = doctors.id 
        AND locations.zone_id = (SELECT assigned_zone_id FROM public.profiles WHERE id = auth.uid())
    )
);
