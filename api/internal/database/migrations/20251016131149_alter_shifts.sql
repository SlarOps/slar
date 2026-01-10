ALTER TABLE shifts 
ADD COLUMN schedule_scope text NOT NULL DEFAULT 'group';
