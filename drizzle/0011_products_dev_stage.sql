-- Dữ liệu: sản phẩm đang bán (active) coi là đã thương mại hóa (00-tong-quan.md mục 3.2).
UPDATE "products" SET "dev_stage" = 'commercial' WHERE "status" = 'active';
