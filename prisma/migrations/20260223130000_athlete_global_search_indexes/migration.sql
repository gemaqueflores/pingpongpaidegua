-- Improve global athlete directory/search paths
CREATE INDEX IF NOT EXISTS "athletes_created_from_warning_name_display_idx"
  ON "athletes" ("created_from_warning", "name_display");

CREATE INDEX IF NOT EXISTS "athletes_created_from_warning_name_normalized_idx"
  ON "athletes" ("created_from_warning", "name_normalized");
