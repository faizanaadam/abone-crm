-- Allow Admins to fully manage locations
CREATE POLICY "Admins can update locations" 
ON public.locations 
FOR UPDATE 
USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can insert locations" 
ON public.locations 
FOR INSERT 
WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete locations" 
ON public.locations 
FOR DELETE 
USING (public.get_user_role() = 'admin');
