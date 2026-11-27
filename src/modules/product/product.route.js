'use strict';
const ProductController = require( './product.controller' );
const AuthController = require( '../auth/auth.controller' );
const { requireAdmin } = require( '../../utils/access' );
const express = require( 'express' );
const multer = require( 'multer' );
const router = express.Router();

// In-memory upload for the bulk-import template (parsed, never stored on disk).
const upload = multer( {
    'storage': multer.memoryStorage(),
    'limits': { 'fileSize': 1024 * 1024 * 10 }
} );

/**
 * Reads are public (the storefront catalogue needs them, and so do the
 * purchase and sale entry screens, which staff use to pick items).
 * Writes — including the bulk template and export — are admin-only: the
 * catalogue is maintained centrally, not per outlet.
 */
router.get( '/', ProductController.getAll );
// NOTE: static paths must be declared before '/:id' so they aren't read as ids.
router.get( '/template', AuthController.checkLogin, requireAdmin, ProductController.downloadTemplate );
router.get( '/export', AuthController.checkLogin, requireAdmin, ProductController.downloadItems );
router.post(
    '/upload',
    AuthController.checkLogin,
    requireAdmin,
    upload.single( 'file' ),
    ProductController.uploadTemplate
);
router.put( '/reorder', AuthController.checkLogin, requireAdmin, ProductController.reorder );
// POST rather than DELETE: a list of ids belongs in a body, and DELETE with a
// body is unevenly supported along the way.
router.post( '/delete-many', AuthController.checkLogin, requireAdmin, ProductController.deleteMany );
router.get( '/:id', ProductController.get );
router.post( '/', AuthController.checkLogin, requireAdmin, ProductController.insert );
router.put( '/:id', AuthController.checkLogin, requireAdmin, ProductController.update );
router.delete( '/:id', AuthController.checkLogin, requireAdmin, ProductController.delete );


module.exports = router;
