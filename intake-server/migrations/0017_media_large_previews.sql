-- Full-resolution previews of 50 MP phone photos exceed the original 24 MP and 20 MiB bounds.
ALTER TABLE media_blob DROP CONSTRAINT media_blob_byte_size_check;
ALTER TABLE media_blob ADD CONSTRAINT media_blob_byte_size_check CHECK(byte_size BETWEEN 1 AND 67108864);
ALTER TABLE media_preview DROP CONSTRAINT media_preview_check;
ALTER TABLE media_preview ADD CONSTRAINT media_preview_check CHECK(width::bigint*height<=52000000);
