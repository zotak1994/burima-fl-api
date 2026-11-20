'use strict';
const ProductController = require( './product.controller' );
const AuthController = require( '../auth/auth.controller' );
const express = require( 'express' );
const multer = require( 'multer' );
const router = express.Router();

// In-memory upload for the bulk-import template (parsed, never stored on disk).
const upload = multer( {
    'storage': multer.memoryStorage(),
    'limits': { 'fileSize': 1024 * 1024 * 10 }
} );

/**
 * Reads are public (the storefront catalogue needs them).
 * Writes require a valid admin JWT (Authorization: Bearer <token>).
 */
router.get( '/', ProductController.getAll );
// NOTE: static paths must be declared before '/:id' so they aren't read as ids.
router.get( '/template', AuthController.checkLogin, ProductController.downloadTemplate );
router.get( '/export', AuthController.checkLogin, ProductController.downloadItems );
router.get( '/price-list', AuthController.checkLogin, ProductController.downloadPriceList );
router.post(
    '/upload',
    AuthController.checkLogin,
    upload.single( 'file' ),
    ProductController.uploadTemplate
);
router.post(
    '/update-prices',
    AuthController.checkLogin,
    upload.single( 'file' ),
    ProductController.uploadPrices
);
router.put( '/reorder', AuthController.checkLogin, ProductController.reorder );
router.get( '/:id', ProductController.get );
router.post( '/', AuthController.checkLogin, ProductController.insert );
router.put( '/:id', AuthController.checkLogin, ProductController.update );
router.delete( '/:id', AuthController.checkLogin, ProductController.delete );


module.exports = router;
