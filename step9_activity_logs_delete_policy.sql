-- ==============================================================================
-- Abone Surgicals CRM - Activity Logs Delete Policy
-- Run this in your Supabase SQL Editor.
-- ==============================================================================

-- Allow reps to delete their own visit logs (for the unvisit/remove features)
DROP POLICY IF EXISTS "Reps can delete their own logs" ON public.activity_logs;

CREATE POLICY "Reps can delete their own logs" 
ON public.activity_logs 
FOR DELETE 
USING (auth.uid() = rep_id);
