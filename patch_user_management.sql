-- ==============================================================================
-- Abone Surgicals CRM - Fix User Creation Function and Purge Corrupted User
-- Run this in your Supabase SQL Editor.
-- ==============================================================================

-- 1. Purge the corrupted user 'rep@abone.com' and any dangling profile/identities
DELETE FROM public.profiles WHERE email = 'rep@abone.com';
DELETE FROM auth.identities WHERE provider_id = 'rep@abone.com' OR email = 'rep@abone.com';
DELETE FROM auth.users WHERE email = 'rep@abone.com';

-- 2. Update the create_rep_user function to use v_user_id::text as provider_id
CREATE OR REPLACE FUNCTION public.create_rep_user(
    p_email TEXT,
    p_password TEXT,
    p_zone_id TEXT,
    p_first_name TEXT,
    p_last_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_user_id UUID;
    v_encrypted_password TEXT;
BEGIN
    -- Check if caller is admin
    IF public.get_user_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only administrators can create users.';
    END IF;

    -- Check if email already exists
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
        RAISE EXCEPTION 'User with this email already exists.';
    END IF;

    -- Generate UUID and encrypt password using gen_salt (pgcrypto)
    v_user_id := gen_random_uuid();
    v_encrypted_password := crypt(p_password, gen_salt('bf', 10));

    -- Insert into auth.users
    INSERT INTO auth.users (
        id,
        instance_id,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        aud,
        role,
        created_at,
        updated_at,
        phone,
        is_sso_user
    ) VALUES (
        v_user_id,
        '00000000-0000-0000-0000-000000000000',
        p_email,
        v_encrypted_password,
        now(),
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        '{}'::jsonb,
        'authenticated',
        'authenticated',
        now(),
        now(),
        '',
        false
    );

    -- Insert into auth.identities
    INSERT INTO auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at,
        provider_id
    ) VALUES (
        v_user_id,
        v_user_id,
        json_build_object('sub', v_user_id, 'email', p_email)::jsonb,
        'email',
        now(),
        now(),
        now(),
        v_user_id::text  -- FIX: In modern Supabase, email provider_id must be the user's UUID string
    );

    -- Update profiles (first_name, last_name, and zone_id)
    UPDATE public.profiles
    SET 
        role = 'rep',
        assigned_zone_id = p_zone_id,
        first_name = p_first_name,
        last_name = p_last_name
    WHERE id = v_user_id;

    RETURN v_user_id;
END;
$$;
