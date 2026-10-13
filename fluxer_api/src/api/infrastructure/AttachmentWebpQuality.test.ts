// SPDX-License-Identifier: AGPL-3.0-or-later

import {getScaledImageOutputFormat, resolveAttachmentWebpQuality, resolveAttachmentWebpSettings} from './AttachmentWebpQuality';
import {describe, expect, it} from 'vitest';

describe('attachment image processing settings', () => {
	it('defaults conversion and scaling on with a 1920x1080 bound and quality 85', () => {
		expect(resolveAttachmentWebpSettings({} as NodeJS.ProcessEnv)).toEqual({
			convertToWebp: true, scaleImages: true, maxWidth: 1920, maxHeight: 1080, quality: 85,
		});
	});
	it('allows conversion and scaling to be controlled independently', () => {
		expect(resolveAttachmentWebpSettings({
			FLUXER_ATTACHMENT_WEBP_CONVERSION_ENABLED: 'false',
			FLUXER_ATTACHMENT_IMAGE_SCALING_ENABLED: 'true',
			FLUXER_ATTACHMENT_IMAGE_MAX_RESOLUTION: '1280x720',
			FLUXER_ATTACHMENT_WEBP_QUALITY: '92',
		} as NodeJS.ProcessEnv)).toEqual({
			convertToWebp: false, scaleImages: true, maxWidth: 1280, maxHeight: 720, quality: 92,
		});
		expect(resolveAttachmentWebpSettings({
			FLUXER_ATTACHMENT_WEBP_CONVERSION_ENABLED: 'true',
			FLUXER_ATTACHMENT_IMAGE_SCALING_ENABLED: 'false',
		} as NodeJS.ProcessEnv)).toMatchObject({convertToWebp: true, scaleImages: false});
	});
	it.each(['0x1080', '1920x0', '40000x40000', 'hd', '1920 by 1080'])('rejects invalid maximum resolution %s', (value) => {
		expect(() => resolveAttachmentWebpSettings({FLUXER_ATTACHMENT_IMAGE_MAX_RESOLUTION: value} as NodeJS.ProcessEnv))
			.toThrow('FLUXER_ATTACHMENT_IMAGE_MAX_RESOLUTION');
	});
	it.each(['yes', '1', 'TRUEISH', ''])('rejects invalid feature toggle %s', (value) => {
		expect(() => resolveAttachmentWebpSettings({FLUXER_ATTACHMENT_WEBP_CONVERSION_ENABLED: value} as NodeJS.ProcessEnv))
			.toThrow('FLUXER_ATTACHMENT_WEBP_CONVERSION_ENABLED');
	});
	it.each(['1', '50', '85', '100'])('accepts WebP quality %s', (value) => {
		expect(resolveAttachmentWebpQuality(value)).toBe(Number(value));
	});
	it.each(['', '0', '101', '-1', '85.5', '85abc', 'NaN', 'Infinity'])('rejects invalid quality %s', (value) => {
		expect(() => resolveAttachmentWebpQuality(value)).toThrow('integer between 1 and 100');
	});
	it('chooses a safe output format for formats needing rasterization', () => {
		expect(getScaledImageOutputFormat('jpeg')).toEqual({extension: 'jpg', contentType: 'image/jpeg'});
		expect(getScaledImageOutputFormat('bmp')).toEqual({extension: 'png', contentType: 'image/png'});
	});
});
