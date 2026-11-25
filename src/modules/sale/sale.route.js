'use strict';
const SaleController = require( './sale.controller' );
const AuthController = require( '../auth/auth.controller' );
const express = require( 'express' );
const router = express.Router();

/**
 * Sales are internal stock records, so every route — reads included —
 * requires a valid admin JWT.
 */
router.use( AuthController.checkLogin );

router.get( '/', SaleController.getAll );
// Named routes before '/:id' so none is ever read as an id.
router.get( '/report', SaleController.report );
router.get( '/summary', SaleController.summary );
router.put( '/:id/confirm', SaleController.confirm );
router.put( '/:id/unconfirm', SaleController.unconfirm );
router.get( '/:id', SaleController.get );
router.post( '/', SaleController.insert );
router.put( '/:id', SaleController.update );
router.delete( '/:id', SaleController.delete );

module.exports = router;
