-- ==============================================================================
-- Abone Surgicals CRM - Relational Schema Migration
-- Run this entire script in the Supabase SQL Editor.
-- ==============================================================================

-- 1. BACKUP EXISTING TABLE
-- We rename your existing flat 'doctors' table so you don't lose any data.
ALTER TABLE IF EXISTS doctors RENAME TO doctors_flat_backup;
ALTER TABLE IF EXISTS doctors_flat_backup DISABLE ROW LEVEL SECURITY;

-- 2. ENUM TYPES
-- Create custom types for user roles (if it doesn't already exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('admin', 'rep');
    END IF;
END$$;

-- 3. PROFILES TABLE (Linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'rep',
    assigned_zone_id TEXT, 
    first_name TEXT,
    last_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. NEW DOCTORS TABLE (Master Info)
CREATE TABLE doctors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    koa_no TEXT,
    name TEXT NOT NULL,
    specialization TEXT,
    spec_category TEXT,
    abone_usage_percentage NUMERIC, 
    phone TEXT,
    email TEXT,
    rep_notes TEXT,
    is_approximate BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. LOCATIONS TABLE (One-to-Many relation to Doctors)
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    hospital_name TEXT NOT NULL,
    hospital_address TEXT,
    map_link TEXT, 
    category TEXT, 
    consultation_timing TEXT,
    is_primary BOOLEAN DEFAULT false,
    lat NUMERIC,
    lon NUMERIC,
    zone_id TEXT, 
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_locations_doctor_id ON locations(doctor_id);
CREATE INDEX IF NOT EXISTS idx_locations_zone_id ON locations(zone_id);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ==============================================================================

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles 
    FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles 
    FOR ALL USING (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
    );

-- Locations Policies: Reps see their zone, Admins see all.
DROP POLICY IF EXISTS "Reps see locations in their zone" ON locations;
CREATE POLICY "Reps see locations in their zone" ON locations
    FOR SELECT USING (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin' OR 
        zone_id = (SELECT assigned_zone_id FROM profiles WHERE id = auth.uid())
    );

-- Doctors Policies: Reps see doctors who have at least one location in their zone.
DROP POLICY IF EXISTS "Reps see doctors in their zone" ON doctors;
CREATE POLICY "Reps see doctors in their zone" ON doctors
    FOR SELECT USING (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin' OR 
        EXISTS (
            SELECT 1 FROM locations 
            WHERE locations.doctor_id = doctors.id 
            AND locations.zone_id = (SELECT assigned_zone_id FROM profiles WHERE id = auth.uid())
        )
    );

-- Allow full public read access for now to ensure the frontend doesn't break
-- before auth is fully set up in app.js. (You can remove this later)
CREATE POLICY "Enable public read access for doctors" ON doctors FOR SELECT USING (true);
CREATE POLICY "Enable public read access for locations" ON locations FOR SELECT USING (true);
