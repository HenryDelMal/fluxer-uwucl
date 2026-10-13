// SPDX-License-Identifier: AGPL-3.0-or-later

export interface AttachmentWebpSettings {
	convertToWebp: boolean;
	scaleImages: boolean;
	maxWidth: number;
	maxHeight: number;
	quality: number;
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
	if (value === undefined) return fallback;
	const normalized = value.trim().toLowerCase();
	if (normalized === 'true') return true;
	if (normalized === 'false') return false;
	throw new Error(`${name} must be "true" or "false"`);
}

function parseMaximumResolution(value: string | undefined): {width: number; height: number} {
	if (value === undefined) return {width: 1920, height: 1080};
	const match = /^(\d+)\s*x\s*(\d+)$/iu.exec(value.trim());
	if (!match) throw new Error('FLUXER_ATTACHMENT_IMAGE_MAX_RESOLUTION must use WIDTHxHEIGHT, for example 1920x1080');
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		width > 32768 ||
		height > 32768 ||
		width * height > 268_402_689
	) {
		throw new Error('FLUXER_ATTACHMENT_IMAGE_MAX_RESOLUTION dimensions are outside the supported range');
	}
	return {width, height};
}

export function resolveAttachmentWebpQuality(value?: string): number {
	if (value === undefined) return 85;
	const normalized = value.trim();
	if (!/^[0-9]+$/u.test(normalized)) {
		throw new Error('FLUXER_ATTACHMENT_WEBP_QUALITY must be an integer between 1 and 100');
	}
	const quality = Number(normalized);
	if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
		throw new Error('FLUXER_ATTACHMENT_WEBP_QUALITY must be an integer between 1 and 100');
	}
	return quality;
}

export function resolveAttachmentWebpSettings(env: NodeJS.ProcessEnv = process.env): AttachmentWebpSettings {
	const resolution = parseMaximumResolution(env.FLUXER_ATTACHMENT_IMAGE_MAX_RESOLUTION);
	return {
		convertToWebp: parseBoolean(
			env.FLUXER_ATTACHMENT_WEBP_CONVERSION_ENABLED,
			true,
			'FLUXER_ATTACHMENT_WEBP_CONVERSION_ENABLED',
		),
		scaleImages: parseBoolean(
			env.FLUXER_ATTACHMENT_IMAGE_SCALING_ENABLED,
			true,
			'FLUXER_ATTACHMENT_IMAGE_SCALING_ENABLED',
		),
		maxWidth: resolution.width,
		maxHeight: resolution.height,
		quality: resolveAttachmentWebpQuality(env.FLUXER_ATTACHMENT_WEBP_QUALITY),
	};
}

export function getScaledImageOutputFormat(format: string | undefined): {
	extension: string;
	contentType: string;
} {
	const normalized = format
		?.split(';', 1)[0]
		?.trim()
		.toLowerCase()
		.replace(/^image\//u, '');
	switch (normalized) {
		case 'jpg':
		case 'jpeg':
			return {extension: 'jpg', contentType: 'image/jpeg'};
		case 'png':
			return {extension: 'png', contentType: 'image/png'};
		case 'gif':
			return {extension: 'gif', contentType: 'image/gif'};
		case 'webp':
			return {extension: 'webp', contentType: 'image/webp'};
		case 'tif':
		case 'x-tiff':
		case 'tiff':
			return {extension: 'tiff', contentType: 'image/tiff'};
		case 'avif':
		case 'heic':
		case 'heif':
			return {extension: 'avif', contentType: 'image/avif'};
		default:
			return {extension: 'png', contentType: 'image/png'};
	}
}
