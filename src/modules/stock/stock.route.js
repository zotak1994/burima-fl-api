'use strict';
const StockController = require( './stock.controller' );
const AuthController = require( '../auth/auth.controller' );
const express = require( 'express' );
const router = express.Router();

/** Stock figures are internal, so every route needs an admin JWT. */
router.use( AuthController.checkLogin );

// Named routes first, so none of them is ever read as an id.
router.get( '/totals', StockController.totals );
router.get( '/movements', StockController.movements );
router.post( '/rebuild', StockController.rebuild );
router.get( '/', StockController.report );

module.exports = router;
