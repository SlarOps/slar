-- Note: RLS is already enabled on storage.objects and storage.buckets by Supabase
-- This migration creates policies for user-specific bucket access

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Users can upload files to own bucket" ON storage.objects;
DROP POLICY IF EXISTS "Users can update files in own bucket" ON storage.objects;
DROP POLICY IF EXISTS "Users can read files from own bucket" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete files from own bucket" ON storage.objects;

-- Policy: Users can upload files to their own bucket (INSERT)
-- Bucket name must match user's ID from auth.users
CREATE POLICY "Users can upload files to own bucket"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = auth.uid()::text
);

-- Policy: Users can update files in their own bucket (UPDATE)
CREATE POLICY "Users can update files in own bucket"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = auth.uid()::text
)
WITH CHECK (
  bucket_id = auth.uid()::text
);

-- Policy: Users can read files from their own bucket (SELECT)
CREATE POLICY "Users can read files from own bucket"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = auth.uid()::text
);

-- Policy: Users can delete files from their own bucket (DELETE)
CREATE POLICY "Users can delete files from own bucket"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = auth.uid()::text
);

-- Create a helper function to check if user owns the bucket
CREATE OR REPLACE FUNCTION public.user_owns_bucket(bucket_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if the bucket name matches the authenticated user's ID
  RETURN bucket_name = auth.uid()::text;
END;
$$;

-- Grant execute permission on the helper function
GRANT EXECUTE ON FUNCTION public.user_owns_bucket(text) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.user_owns_bucket(text) IS
  'Helper function to verify that the authenticated user owns the specified bucket (bucket name = user ID)';

-- Drop existing bucket policies if they exist
DROP POLICY IF EXISTS "Users can view own bucket" ON storage.buckets;
DROP POLICY IF EXISTS "Users can create own bucket" ON storage.buckets;
DROP POLICY IF EXISTS "Users can update own bucket" ON storage.buckets;
DROP POLICY IF EXISTS "Users can delete own bucket" ON storage.buckets;

-- Policy: Users can create their own bucket
-- This allows the app to create a bucket for the user if it doesn't exist
-- Bucket name must match user's auth.uid()
CREATE POLICY "Users can create own bucket"
ON storage.buckets
FOR INSERT
TO authenticated
WITH CHECK (
  name = auth.uid()::text
);

-- Policy: Users can view their own bucket
CREATE POLICY "Users can view own bucket"
ON storage.buckets
FOR SELECT
TO authenticated
USING (
  name = auth.uid()::text
);

-- Policy: Users can update their own bucket settings
CREATE POLICY "Users can update own bucket"
ON storage.buckets
FOR UPDATE
TO authenticated
USING (
  name = auth.uid()::text
)
WITH CHECK (
  name = auth.uid()::text
);

-- Policy: Users can delete their own bucket
CREATE POLICY "Users can delete own bucket"
ON storage.buckets
FOR DELETE
TO authenticated
USING (
  name = auth.uid()::text
);
