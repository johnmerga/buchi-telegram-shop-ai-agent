import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  MAX_PRODUCT_PHOTO_BYTES,
  productInputSchema,
  productPhotoTypes,
  variantsInputSchema,
} from '@buchi/shared';
import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { callerOf } from '../../http/caller';
import { parseInput } from '../../http/validate';
import { AppError } from '../../shared/errors';
import type { CatalogService } from './catalog.service';

/** Puts an image on Telegram's servers and returns its file ID. Telegram is the only implementation. */
export interface PhotoUploads {
  upload(ownerChatId: number, image: Buffer): Promise<string>;
}

/** Opens a product photo kept on Telegram. Telegram is the only implementation. */
export interface PhotoFiles {
  open(fileId: string): Promise<{ contentType: string; body: Readable }>;
}

const shopParams = z.object({ shopId: z.uuid() });
const productParams = shopParams.extend({ productId: z.uuid() });
const photoParams = productParams.extend({ index: z.coerce.number().int().min(0) });

const parseImage = express.raw({ type: productPhotoTypes, limit: MAX_PRODUCT_PHOTO_BYTES });
const photoRules = 'Send one JPEG, PNG, or WebP image of at most 10 MB';

/** Reads the request body as an image, and answers a body that is too large with 413. */
const imageBody: RequestHandler = (req, res, next) => {
  parseImage(req, res, (err: unknown) => {
    const tooLarge = z.object({ type: z.literal('entity.too.large') }).safeParse(err).success;
    next(tooLarge ? new AppError('TOO_LARGE', photoRules) : err);
  });
};

/** Owner routes for products. Every route sits behind sign-in and the shop owner check. */
export function createCatalogRouter(deps: {
  catalog: CatalogService;
  uploads: PhotoUploads;
  files: PhotoFiles;
  requireAuth: RequestHandler;
  requireShopOwner: RequestHandler;
}): Router {
  const { catalog, uploads, files, requireAuth, requireShopOwner } = deps;
  const router = Router();

  router.get('/shops/:shopId/products', requireAuth, requireShopOwner, async (req, res) => {
    res.json(await catalog.listProducts(parseInput(shopParams, req.params).shopId));
  });

  router.post('/shops/:shopId/products', requireAuth, requireShopOwner, async (req, res) => {
    const { shopId } = parseInput(shopParams, req.params);
    res
      .status(201)
      .json(await catalog.createProduct(shopId, parseInput(productInputSchema, req.body)));
  });

  router.put(
    '/shops/:shopId/products/:productId',
    requireAuth,
    requireShopOwner,
    async (req, res) => {
      const { shopId, productId } = parseInput(productParams, req.params);
      res.json(
        await catalog.updateProduct(shopId, productId, parseInput(productInputSchema, req.body)),
      );
    },
  );

  router.delete(
    '/shops/:shopId/products/:productId',
    requireAuth,
    requireShopOwner,
    async (req, res) => {
      const { shopId, productId } = parseInput(productParams, req.params);
      res.json(await catalog.removeProduct(shopId, productId));
    },
  );

  router.post(
    '/shops/:shopId/products/:productId/restore',
    requireAuth,
    requireShopOwner,
    async (req, res) => {
      const { shopId, productId } = parseInput(productParams, req.params);
      res.json(await catalog.restoreProduct(shopId, productId));
    },
  );

  router.put(
    '/shops/:shopId/products/:productId/variants',
    requireAuth,
    requireShopOwner,
    async (req, res) => {
      const { shopId, productId } = parseInput(productParams, req.params);
      await catalog.setVariants(shopId, productId, parseInput(variantsInputSchema, req.body));
      res.sendStatus(204);
    },
  );

  router.post(
    '/shops/:shopId/products/:productId/post',
    requireAuth,
    requireShopOwner,
    async (req, res) => {
      const { shopId, productId } = parseInput(productParams, req.params);
      res.status(201).json(await catalog.postToChannel(shopId, productId));
    },
  );

  /**
   * The image goes to the owner's chat with the bot, because only a sent message gets a Telegram
   * file ID. The photo then lives on Telegram, like one the owner sends to the bot.
   */
  router.post(
    '/shops/:shopId/products/:productId/photos',
    requireAuth,
    requireShopOwner,
    imageBody,
    async (req, res) => {
      const { shopId, productId } = parseInput(productParams, req.params);
      const image: unknown = req.body;
      if (!Buffer.isBuffer(image) || image.length === 0) {
        throw new AppError('VALIDATION_FAILED', photoRules);
      }
      const fileId = await uploads.upload(callerOf(req).telegramUserId, image);
      res.status(201).json(await catalog.attachPhoto([shopId], productId, fileId));
    },
  );

  /** Streams the photo from Telegram on each request, so Buchi never stores it. */
  router.get(
    '/shops/:shopId/products/:productId/photos/:index',
    requireAuth,
    requireShopOwner,
    async (req, res) => {
      const { shopId, productId, index } = parseInput(photoParams, req.params);
      const file = await files.open(await catalog.photoFileId(shopId, productId, index));
      res.set({
        'content-type': file.contentType,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      });
      await pipeline(file.body, res);
    },
  );

  return router;
}
