-- Allow Admins to View all pending edits
CREATE POLICY "Admins can view all pending edits" 
ON public.pending_edits 
FOR SELECT 
USING (public.get_user_role() = 'admin');

-- Allow Admins to Update (Approve/Reject) pending edits
CREATE POLICY "Admins can update pending edits" 
ON public.pending_edits 
FOR UPDATE 
USING (public.get_user_role() = 'admin');
