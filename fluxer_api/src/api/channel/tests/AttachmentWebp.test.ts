
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {temporaryFile} from 'tempy';
import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {createGuild, createChannel, sendMessageWithAttachments} from '@app/api/channel/tests/AttachmentTestUtils';
import {processAttachmentImageToWebp} from '@app/api/infrastructure/StorageObjectHelpers';
import {setInjectedMediaService} from '@app/api/middleware/ServiceRegistry';
import {createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {TestMediaService} from '@app/api/test/TestMediaService';
import {describe, expect, it, vi} from 'vitest';

describe('WebP message attachment finalization', () => {
	it('persists the WebP name, MIME type, size and resized dimensions in the message response', async () => {
		const harness = await createApiTestHarness();
		await harness.reset();
		setInjectedMediaService(new TestMediaService(harness.storageService));
		const spy = vi.spyOn(harness.storageService, 'copyObjectWithMetadataStripping').mockImplementation(async (params) => {
			expect(params.convertImagesToWebp).toBe(true);
			expect(params.scaleImages).toBe(true);
			expect([params.maxWidth, params.maxHeight, params.webpQuality]).toEqual([1920, 1080, 85]);
			expect(params.destinationKey.endsWith('/photo.webp')).toBe(true);
			const input = params.sourceLocalPath ?? temporaryFile();
			const output = temporaryFile({extension: 'webp'});
			try {
				if (!params.sourceLocalPath) await harness.storageService.writeObjectToDisk(params.sourceBucket, params.sourceKey, input);
				const result = await processAttachmentImageToWebp(input, output);
				await harness.storageService.uploadObject({bucket: params.destinationBucket, key: params.destinationKey,
					body: new Uint8Array(await fs.readFile(output)), contentType: result.contentType});
				return result;
			} finally {
				await fs.unlink(output).catch(() => undefined);
				if (!params.sourceLocalPath) await fs.unlink(input).catch(() => undefined);
			}
		});
		try {
			const account = await createTestAccount(harness);
			const guild = await createGuild(harness, account.token, 'WebP test guild');
			const channel = await createChannel(harness, account.token, guild.id, 'webp-test');
			const data = await sharp({create: {width: 2400, height: 1200, channels: 3, background: '#336699'}}).png().toBuffer();
			const {response, json, text} = await sendMessageWithAttachments(harness, account.token, guild.system_channel_id ?? channel.id,
				{content: 'WebP check', attachments: [{id: 0, filename: 'photo.png'}]},
				[{index: 0, filename: 'photo.png', contentType: 'image/png', data}]);
			expect(response.status, text).toBe(200);
			expect(json.attachments?.[0]).toMatchObject({filename: 'photo.webp', title: 'photo.png',
				content_type: 'image/webp', width: 1920, height: 960});
			expect(spy).toHaveBeenCalledTimes(1);
			expect(json.attachments?.[0]?.size).toBeGreaterThan(0);
		} finally {
			spy.mockRestore();
		}
	}, 40000);
});
