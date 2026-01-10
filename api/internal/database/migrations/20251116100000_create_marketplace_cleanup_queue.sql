-- Create PGMQ queue for marketplace cleanup tasks
-- Background worker (in-process with FastAPI) will poll this queue

-- Create the queue using PGMQ extension
SELECT pgmq.create('marketplace_cleanup_queue');

