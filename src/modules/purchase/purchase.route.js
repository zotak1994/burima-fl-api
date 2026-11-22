'use strict';
const PurchaseController = require( './purchase.controller' );
const AuthController = require( '../auth/auth.controller' );
const express = require( 'express' );
const router = express.Router();

/**
 * Purchases are internal stock records, so every route — reads included —
 * requires a valid admin JWT. Nothing here is needed by a storefront.
 */
router.use( AuthController.checkLogin );

router.get( '/', PurchaseController.getAll );
// NOTE: declared before '/:id' so 'confirm' is never read as an id.
router.put( '/:id/confirm', PurchaseController.confirm );
router.put( '/:id/unconfirm', PurchaseController.unconfirm );
router.get( '/:id', PurchaseController.get );
router.post( '/', PurchaseController.insert );
router.put( '/:id', PurchaseController.update );
router.delete( '/:id', PurchaseController.delete );


module.exports = router;
