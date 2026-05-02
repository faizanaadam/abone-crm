-- Drop existing policies on pending_edits to avoid conflicts
DROP POLICY IF EXISTS "Reps can insert their own suggestions" ON public.pending_edits;
DROP POLICY IF EXISTS "Reps can view their own suggestions" ON public.pending_edits;
DROP POLICY IF EXISTS "Admins can view all pending edits" ON public.pending_edits;
DROP POLICY IF EXISTS "Admins can update pending edits" ON public.pending_edits;
DROP POLICY IF EXISTS "Reps can update their own pending edits" ON public.pending_edits;
DROP POLICY IF EXISTS "Reps can delete their own pending edits" ON public.pending_edits;

-- 1. ADMIN POLICIES: Admins can do everything (Select, Update, Delete)
CREATE POLICY "Admins have full access to pending edits" 
ON public.pending_edits 
FOR ALL 
USING (public.get_user_role() = 'admin');

-- 2. REP POLICIES: Reps can only insert, select, update, and delete their OWN suggestions
CREATE POLICY "Reps can view their own suggestions" 
ON public.pending_edits 
FOR SELECT 
USING (auth.uid() = suggested_by);

CREATE POLICY "Reps can insert their own suggestions" 
ON public.pending_edits 
FOR INSERT 
WITH CHECK (auth.uid() = suggested_by);

CREATE POLICY "Reps can update their own suggestions" 
ON public.pending_edits 
FOR UPDATE 
USING (auth.uid() = suggested_by);

CREATE POLICY "Reps can delete their own suggestions" 
ON public.pending_edits 
FOR DELETE 
USING (auth.uid() = suggested_by);
