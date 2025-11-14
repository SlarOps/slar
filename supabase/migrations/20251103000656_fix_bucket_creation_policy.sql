-- Fix: Enable bucket creation for authenticated users
-- This migration adds the missing bucket creation policy

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
