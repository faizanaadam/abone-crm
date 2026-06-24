-- ==============================================================================
-- Abone Surgicals CRM - Secure Tables & Enable Row Level Security (RLS)
-- Run this in your Supabase SQL Editor.
-- ==============================================================================

-- 1. Enable RLS on the backup table
-- Since it's a backup, enabling RLS without adding any policies secures it 
-- so only you (Admin via Dashboard/Service Role) can see or modify it.
ALTER TABLE IF EXISTS public.doctors_flat_backup ENABLE ROW LEVEL SECURITY;

-- 2. Confirm RLS is enabled on all other active tables
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pending_edits ENABLE ROW LEVEL SECURITY;
