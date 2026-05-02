-- Allow Admins to UPDATE doctors
CREATE POLICY "Admins can update doctors" 
ON public.doctors 
FOR UPDATE 
USING (public.get_user_role() = 'admin');

-- (Optional but recommended) Allow Admins to INSERT/DELETE doctors
CREATE POLICY "Admins can insert doctors" 
ON public.doctors 
FOR INSERT 
WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "Admins can delete doctors" 
ON public.doctors 
FOR DELETE 
USING (public.get_user_role() = 'admin');
