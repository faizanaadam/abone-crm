-- Run this in Supabase SQL Editor before seeding
ALTER TABLE public.doctors
    ADD COLUMN IF NOT EXISTS spec_category TEXT DEFAULT 'General',
    ADD COLUMN IF NOT EXISTS area_name TEXT;
