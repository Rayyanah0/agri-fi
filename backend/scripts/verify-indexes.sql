-- Script to verify that indexes are created and being used
-- Run this after applying migration 1700000008 (query-path indexes) and
-- migration 2100000000000 (outbox pending-event index)

-- 1. Check that all indexes exist
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('investments', 'shipment_milestones', 'payment_distributions', 'api_keys')
    AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- 2. Verify investment availability query uses composite index
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM investments 
WHERE trade_deal_id = '00000000-0000-0000-0000-000000000000'::uuid 
    AND status = 'confirmed';

-- 3. Verify investor dashboard query uses investor_id index  
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM investments 
WHERE investor_id = '00000000-0000-0000-0000-000000000000'::uuid
ORDER BY created_at DESC;

-- 4. Verify milestone queries use trade_deal_id index
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM shipment_milestones 
WHERE trade_deal_id = '00000000-0000-0000-0000-000000000000'::uuid
ORDER BY recorded_at ASC;

-- 5. Verify payment distribution queries use composite trade_deal_id + status index
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM payment_distributions 
WHERE trade_deal_id = '00000000-0000-0000-0000-000000000000'::uuid
    AND status = 'confirmed';

-- 6. Verify API key prefix lookups use the prefix index
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM api_keys
WHERE prefix = 'agfi_live_123456';

-- 7. Verify dashboard queries use partial indexes
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM trade_deals 
WHERE status = 'open';

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM investments 
WHERE status = 'active';

-- 8. Verify the outbox pending-event composite index exists with the expected
--    shape: (processed, retry_count, created_at) WHERE processed = FALSE
--    (#968, migration 2100000000000).
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE tablename = 'outbox'
    AND indexname = 'idx_outbox_pending_scan';

-- 8a. The superseded index must be gone, so only one index owns the scan.
SELECT indexname
FROM pg_indexes
WHERE tablename = 'outbox'
    AND indexname = 'idx_outbox_unprocessed';
-- Expected: zero rows.

-- 9. Verify the OutboxService.publishPending worker query uses the composite
--    index. Run this against a table with 100k+ rows (or seed one first) to
--    confirm the plan stays an index scan rather than a sequential scan.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, event_type, payload, processed, retry_count, last_error,
       created_at, updated_at, processed_at
FROM outbox
WHERE processed = FALSE
    AND retry_count < 10
ORDER BY created_at ASC
LIMIT 50
FOR UPDATE SKIP LOCKED;
-- Expected: Index Scan using idx_outbox_pending_scan

-- Expected output should show "Index Scan" or "Index Only Scan" instead of "Seq Scan"