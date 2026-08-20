CREATE TABLE `audioFiles` (
	`id` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`originalName` varchar(512) NOT NULL,
	`storageKey` varchar(1024) NOT NULL,
	`storageUrl` varchar(2048) NOT NULL,
	`mimeType` varchar(255) NOT NULL,
	`sizeBytes` bigint NOT NULL,
	`durationMs` int NOT NULL,
	`sampleRate` int,
	`bitDepth` int,
	`numChannels` int,
	`waveformPeaks` json,
	`waveformBucketCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `audioFiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audioSegments` (
	`id` varchar(64) NOT NULL,
	`audioFileId` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`startMs` int NOT NULL,
	`endMs` int NOT NULL,
	`label` varchar(512),
	`source` enum('manual','vad') NOT NULL DEFAULT 'manual',
	`isConfirmed` boolean NOT NULL DEFAULT false,
	`color` varchar(32),
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `audioSegments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userSlicerSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`silencePrefixMs` int NOT NULL DEFAULT 200,
	`silenceSuffixMs` int NOT NULL DEFAULT 200,
	`vadEnergyThreshold` varchar(32) NOT NULL DEFAULT '0.01',
	`vadMaxSilenceDurationMs` int NOT NULL DEFAULT 500,
	`vadMinSpeechDurationMs` int NOT NULL DEFAULT 100,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userSlicerSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `userSlicerSettings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE INDEX `audioFiles_userId_idx` ON `audioFiles` (`userId`);--> statement-breakpoint
CREATE INDEX `audioSegments_audioFileId_idx` ON `audioSegments` (`audioFileId`);--> statement-breakpoint
CREATE INDEX `audioSegments_userId_idx` ON `audioSegments` (`userId`);