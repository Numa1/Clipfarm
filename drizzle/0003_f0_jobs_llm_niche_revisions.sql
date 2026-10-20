CREATE TABLE `project_revisions` (
	`project_id` text NOT NULL,
	`rev` integer NOT NULL,
	`actor` text NOT NULL,
	`actor_id` text,
	`ops` text,
	`snapshot` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `rev`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_llm_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`project_id` text,
	`moment_id` text,
	`prompt_id` text,
	`prompt_version` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`error` text,
	`purpose` text NOT NULL,
	`model` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_llm_calls`("id", "source_id", "purpose", "model", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd", "duration_ms", "created_at") SELECT "id", "source_id", "purpose", "model", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd", "duration_ms", "created_at" FROM `llm_calls`;--> statement-breakpoint
DROP TABLE `llm_calls`;--> statement-breakpoint
ALTER TABLE `__new_llm_calls` RENAME TO `llm_calls`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_id` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `lane` text DEFAULT 'heavy' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `dedupe_key` text;--> statement-breakpoint
CREATE INDEX `jobs_source_id_idx` ON `jobs` (`source_id`);--> statement-breakpoint
CREATE INDEX `jobs_project_id_idx` ON `jobs` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_key_active_idx` ON `jobs` (`dedupe_key`) WHERE "jobs"."dedupe_key" is not null and "jobs"."status" in ('queued', 'running');--> statement-breakpoint
ALTER TABLE `projects` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `style_id` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `niche` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `niche_confidence` real;--> statement-breakpoint
ALTER TABLE `sources` ADD `niche_signals` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `niche_source` text;--> statement-breakpoint
ALTER TABLE `sources` ADD `lang` text;--> statement-breakpoint
UPDATE `jobs` SET `source_id` = json_extract(`payload`, '$.sourceId'), `project_id` = json_extract(`payload`, '$.projectId'), `lane` = CASE WHEN `type` = 'moments' THEN 'light' ELSE 'heavy' END;
