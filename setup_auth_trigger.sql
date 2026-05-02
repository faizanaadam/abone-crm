-- 1. Create a function that automatically creates a profile for new users
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, role)
  VALUES (new.id, 'rep'); -- Default all new users to 'rep'
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Attach the trigger to the auth.users table
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 3. (Optional but recommended) Backfill any users you already created!
INSERT INTO public.profiles (id, role)
SELECT id, 'rep'
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles);

-- 4. FIX FOR RLS: Prevent Infinite Recursion on Profiles
-- Using CASCADE to drop the function and any policies that depend on it, 
-- so we can cleanly recreate them with the proper SECURITY DEFINER function.
DROP FUNCTION IF EXISTS public.get_user_role() CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- Recreate Profiles Policies
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON profiles FOR ALL USING (public.get_user_role() = 'admin');

-- Recreate Locations Policies
DROP POLICY IF EXISTS "Reps see locations in their zone" ON locations;
CREATE POLICY "Reps see locations in their zone" ON locations FOR SELECT USING (
    public.get_user_role() = 'admin' OR 
    zone_id = (SELECT assigned_zone_id FROM profiles WHERE id = auth.uid())
);

-- Recreate Doctors Policies
DROP POLICY IF EXISTS "Reps see doctors in their zone" ON doctors;
CREATE POLICY "Reps see doctors in their zone" ON doctors FOR SELECT USING (
    public.get_user_role() = 'admin' OR 
    EXISTS (
        SELECT 1 FROM locations 
        WHERE locations.doctor_id = doctors.id 
        AND locations.zone_id = (SELECT assigned_zone_id FROM profiles WHERE id = auth.uid())
    )
);
