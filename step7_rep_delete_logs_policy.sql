-- Allow Reps to delete their own visit logs (for the "Unvisit" feature)
CREATE POLICY "Reps can delete their own logs" 
ON public.activity_logs 
FOR DELETE 
USING (auth.uid() = rep_id);
