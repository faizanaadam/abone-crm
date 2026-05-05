-- ==============================================================================
-- Add Doctor Request Support — Modify pending_edits table
-- Run this in the Supabase SQL Editor.
-- ==============================================================================

-- 1. Add action column to distinguish 'edit' from 'add_doctor'
ALTER TABLE public.pending_edits 
ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'edit';

-- 2. Make doctor_id nullable (new doctors don't exist yet)
ALTER TABLE public.pending_edits 
ALTER COLUMN doctor_id DROP NOT NULL;

-- 3. Update RLS to allow reps to insert add_doctor requests
-- (existing insert policy should already cover this since it checks suggested_by = auth.uid())
