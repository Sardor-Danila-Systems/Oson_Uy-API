-- Store optimised-image metadata alongside each gallery URL.
-- All columns are nullable so existing rows remain valid.
ALTER TABLE "project_media"
    ADD COLUMN "thumbnailUrl" TEXT,
    ADD COLUMN "width" INTEGER,
    ADD COLUMN "height" INTEGER,
    ADD COLUMN "mimeType" TEXT,
    ADD COLUMN "optimizedSize" INTEGER;
