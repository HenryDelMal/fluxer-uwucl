// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	processAttachmentImage,
	processAttachmentImageToWebp,
	stripNonJpegImageMetadataForUpload,
} from '@app/api/infrastructure/StorageObjectHelpers';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {temporaryFile} from 'tempy';
import {describe, expect, it} from 'vitest';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function concatBytes(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const out = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

function textBytes(value: string): Uint8Array {
	const encoded = new TextEncoder().encode(value);
	const out = new Uint8Array(encoded.length);
	out.set(encoded);
	return out;
}

function chunk(type: string, data: Uint8Array<ArrayBufferLike> = new Uint8Array()): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	out[0] = (data.length >>> 24) & 0xff;
	out[1] = (data.length >>> 16) & 0xff;
	out[2] = (data.length >>> 8) & 0xff;
	out[3] = data.length & 0xff;
	out.set(textBytes(type), 4);
	out.set(data, 8);
	return out;
}

function chunkNames(data: Uint8Array): Array<string> {
	const names: Array<string> = [];
	let offset = PNG_SIGNATURE.length;
	while (offset + 12 <= data.length) {
		const length =
			((data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!) >>> 0;
		names.push(String.fromCharCode(data[offset + 4]!, data[offset + 5]!, data[offset + 6]!, data[offset + 7]!));
		offset += 12 + length;
	}
	return names;
}

function pngWithPrivateChunks(): Uint8Array {
	return concatBytes([
		PNG_SIGNATURE,
		chunk('IHDR', new Uint8Array(13)),
		chunk('tEXt', textBytes('GPS=1,2')),
		chunk('prIv', textBytes('private metadata')),
		chunk('IDAT', new Uint8Array([1, 2, 3])),
		chunk('IEND'),
	]);
}

describe('stripNonJpegImageMetadataForUpload', () => {
	it('strips PNG metadata and unknown ancillary chunks while preserving image chunks', async () => {
		const input = pngWithPrivateChunks();
		const stripped = await stripNonJpegImageMetadataForUpload(input, 'image/png');
		expect(stripped.contentType).toBe('image/png');
		expect(chunkNames(stripped.body)).toEqual(['IHDR', 'IDAT', 'IEND']);
	});
	it('preserves APNG animation chunks', async () => {
		const input = concatBytes([
			PNG_SIGNATURE,
			chunk('IHDR', new Uint8Array(13)),
			chunk('acTL', new Uint8Array(8)),
			chunk('fcTL', new Uint8Array(26)),
			chunk('tEXt', textBytes('camera=private')),
			chunk('fdAT', new Uint8Array([1, 2, 3])),
			chunk('IDAT', new Uint8Array([4, 5, 6])),
			chunk('IEND'),
		]);
		const stripped = await stripNonJpegImageMetadataForUpload(input, 'image/apng');
		expect(stripped.contentType).toBe('image/apng');
		expect(chunkNames(stripped.body)).toEqual(['IHDR', 'acTL', 'fcTL', 'fdAT', 'IDAT', 'IEND']);
	});
});

function riffChunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(8 + data.length + (data.length & 1));
	out.set(textBytes(type), 0);
	new DataView(out.buffer).setUint32(4, data.length, true);
	out.set(data, 8);
	return out;
}

function webp(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
	const body = concatBytes(chunks);
	const header = concatBytes([textBytes('RIFF'), new Uint8Array(4), textBytes('WEBP')]);
	new DataView(header.buffer).setUint32(4, 4 + body.length, true);
	return concatBytes([header, body]);
}

describe('stripNonJpegImageMetadataForUpload for WebP', () => {
	it('drops EXIF and XMP chunks without re-encoding frames', async () => {
		const vp8x = new Uint8Array(10);
		vp8x[0] = 0x02 | 0x08 | 0x04;
		const anmf = riffChunk('ANMF', new Uint8Array([9, 8, 7]));
		const input = webp([
			riffChunk('VP8X', vp8x),
			riffChunk('ANIM', new Uint8Array(6)),
			anmf,
			riffChunk('EXIF', textBytes('GPS=1,2')),
			riffChunk('XMP ', textBytes('private metadata')),
		]);
		const stripped = await stripNonJpegImageMetadataForUpload(input, 'image/webp');
		const expectedVp8x = new Uint8Array(10);
		expectedVp8x[0] = 0x02;
		expect(stripped.contentType).toBe('image/webp');
		expect(stripped.body).toEqual(webp([riffChunk('VP8X', expectedVp8x), riffChunk('ANIM', new Uint8Array(6)), anmf]));
	});
});

describe('processAttachmentImageToWebp', () => {
	it('resizes a landscape raster to fit within 1920x1080 and encodes WebP', async () => {
		const inputPath = temporaryFile({extension: 'png'});
		const outputPath = temporaryFile({extension: 'webp'});
		try {
			await sharp({create: {width: 2400, height: 1200, channels: 3, background: '#336699'}})
				.png()
				.toFile(inputPath);
			const processed = await processAttachmentImageToWebp(inputPath, outputPath);
			const metadata = await sharp(outputPath).metadata();
			expect(processed.contentType).toBe('image/webp');
			expect(metadata.format).toBe('webp');
			expect(metadata.width).toBe(1920);
			expect(metadata.height).toBe(960);
			expect(processed.width).toBe(1920);
			expect(processed.height).toBe(960);
			expect(processed.contentLength).toBeGreaterThan(0);
			expect(processed.contentHash).toMatch(/^[a-f0-9]{64}$/u);
		} finally {
			await Promise.all([fs.unlink(inputPath).catch(() => undefined), fs.unlink(outputPath).catch(() => undefined)]);
		}
	});

	it('does not enlarge small raster images', async () => {
		const inputPath = temporaryFile({extension: 'png'});
		const outputPath = temporaryFile({extension: 'webp'});
		try {
			await sharp({create: {width: 320, height: 240, channels: 3, background: '#336699'}})
				.png()
				.toFile(inputPath);
			await processAttachmentImageToWebp(inputPath, outputPath);
			const metadata = await sharp(outputPath).metadata();
			expect(metadata.width).toBe(320);
			expect(metadata.height).toBe(240);
		} finally {
			await Promise.all([fs.unlink(inputPath).catch(() => undefined), fs.unlink(outputPath).catch(() => undefined)]);
		}
	});
});

describe('attachment WebP edge cases', () => {
	it('fits portrait images inside the height limit and keeps transparency', async () => {
		const inputPath = temporaryFile({extension: 'png'});
		const outputPath = temporaryFile({extension: 'webp'});
		try {
			await sharp({create: {width: 1200, height: 2400, channels: 4, background: {r: 10, g: 20, b: 30, alpha: 0.5}}}).png().toFile(inputPath);
			const result = await processAttachmentImageToWebp(inputPath, outputPath);
			const metadata = await sharp(outputPath).metadata();
			expect([result.width, result.height]).toEqual([540, 1080]);
			expect(metadata.hasAlpha).toBe(true);
		} finally {
			await Promise.all([fs.unlink(inputPath).catch(() => undefined), fs.unlink(outputPath).catch(() => undefined)]);
		}
	});

	it('preserves animated frames, timing and loop count and reports frame dimensions', async () => {
		const inputPath = temporaryFile({extension: 'gif'});
		const outputPath = temporaryFile({extension: 'webp'});
		try {
			const width = 1200, height = 1200, pages = 2;
			const pixels = Buffer.alloc(width * height * pages * 3);
			pixels.fill(200, 0, width * height * 3);
			pixels.fill(40, width * height * 3);
			await sharp(pixels, {raw: {width, height: height * pages, channels: 3, pageHeight: height}})
				.gif({loop: 3, delay: [100, 200]}).toFile(inputPath);
			const result = await processAttachmentImageToWebp(inputPath, outputPath);
			const metadata = await sharp(outputPath, {animated: true}).metadata();
			expect(metadata.pages).toBe(2);
			expect(metadata.loop).toBe(3);
			expect(metadata.delay).toEqual([100, 200]);
			expect([result.width, result.height]).toEqual([1080, 1080]);
			expect(metadata.pageHeight).toBe(1080);
		} finally {
			await Promise.all([fs.unlink(inputPath).catch(() => undefined), fs.unlink(outputPath).catch(() => undefined)]);
		}
	});

	it('applies EXIF orientation before calculating the resized dimensions', async () => {
		const inputPath = temporaryFile({extension: 'jpg'});
		const outputPath = temporaryFile({extension: 'webp'});
		try {
			await sharp({create: {width: 2400, height: 1200, channels: 3, background: '#336699'}})
				.withMetadata({orientation: 6}).jpeg().toFile(inputPath);
			const result = await processAttachmentImageToWebp(inputPath, outputPath);
			expect([result.width, result.height]).toEqual([540, 1080]);
			expect((await sharp(outputPath).metadata()).orientation).toBeUndefined();
		} finally {
			await Promise.all([fs.unlink(inputPath).catch(() => undefined), fs.unlink(outputPath).catch(() => undefined)]);
		}
	});
});

describe('attachment image decoder fallback', () => {
	it('converts BMP uploads using system libvips when bundled Sharp cannot read them', async () => {
		const inputPath = temporaryFile({extension: 'bmp'});
		const outputPath = temporaryFile({extension: 'webp'});
		const width = 2400, height = 1200;
		const rowSize = Math.ceil(width * 3 / 4) * 4;
		const bmp = Buffer.alloc(54 + rowSize * height, 100);
		bmp.fill(0, 0, 54);
		bmp.write('BM');
		bmp.writeUInt32LE(bmp.length, 2);
		bmp.writeUInt32LE(54, 10);
		bmp.writeUInt32LE(40, 14);
		bmp.writeInt32LE(width, 18);
		bmp.writeInt32LE(height, 22);
		bmp.writeUInt16LE(1, 26);
		bmp.writeUInt16LE(24, 28);
		bmp.writeUInt32LE(rowSize * height, 34);
		try {
			await fs.writeFile(inputPath, bmp);
			const result = await processAttachmentImageToWebp(inputPath, outputPath);
			const metadata = await sharp(outputPath).metadata();
			expect([metadata.format, result.width, result.height]).toEqual(['webp', 1920, 960]);
		} finally {
			await Promise.all([fs.unlink(inputPath).catch(() => undefined), fs.unlink(outputPath).catch(() => undefined)]);
		}
	});
});

describe('independent attachment image scaling', () => {
	it('resizes a PNG while keeping its format when WebP conversion is disabled', async () => {
		const inputPath = temporaryFile({extension: 'png'});
		const outputPath = temporaryFile({extension: 'png'});
		try {
			await sharp({create: {width: 2400, height: 1200, channels: 4, background: {r: 10, g: 20, b: 30, alpha: 0.5}}}).png().toFile(inputPath);
			const processed = await processAttachmentImage(inputPath, outputPath, {
				convertToWebp: false, scaleImages: true, maxWidth: 1280, maxHeight: 720, quality: 85,
			});
			const metadata = await sharp(outputPath).metadata();
			expect(processed.contentType).toBe('image/png');
			expect([processed.width, processed.height]).toEqual([1280, 640]);
			expect([metadata.format, metadata.width, metadata.height, metadata.hasAlpha]).toEqual(['png', 1280, 640, true]);
		} finally {
			await Promise.all([fs.unlink(inputPath).catch(() => undefined), fs.unlink(outputPath).catch(() => undefined)]);
		}
	});

	it('converts to WebP without resizing when scaling is disabled', async () => {
		const inputPath = temporaryFile({extension: 'png'});
		const outputPath = temporaryFile({extension: 'webp'});
		try {
			await sharp({create: {width: 2400, height: 1200, channels: 3, background: '#336699'}}).png().toFile(inputPath);
			const processed = await processAttachmentImage(inputPath, outputPath, {
				convertToWebp: true, scaleImages: false, maxWidth: 1920, maxHeight: 1080, quality: 85,
			});
			expect(processed.contentType).toBe('image/webp');
			expect([processed.width, processed.height]).toEqual([2400, 1200]);
		} finally {
			await Promise.all([fs.unlink(inputPath).catch(() => undefined), fs.unlink(outputPath).catch(() => undefined)]);
		}
	});
});
