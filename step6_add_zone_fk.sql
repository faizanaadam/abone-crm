-- Add a foreign key constraint from profiles to the zones table.
-- This tells the Supabase Dashboard that assigned_zone_id MUST be a valid zone ID.
-- As a magical bonus, Supabase will automatically convert the text input into a searchable dropdown menu!

ALTER TABLE public.profiles
ADD CONSTRAINT fk_profiles_zone
FOREIGN KEY (assigned_zone_id) 
REFERENCES public.zones(id)
ON DELETE SET NULL;
