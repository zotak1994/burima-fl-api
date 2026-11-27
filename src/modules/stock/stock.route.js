'use strict';
const StockController = require( './stock.controller' );
const AuthController = require( '../auth/auth.controller' );
const { requireAdmin, requirePermission, scopeToShops } = require( '../../utils/access' );
const express = require( 'express' );
const router = express.Router();

/**
 * Stock figures are internal, so every route needs a JWT.
 *
 * The reads answer to the `reports` grant and are held to the outlets
 * assigned to the account. Every one of them is built for a single outlet, so
 * a missing ?shop= is refused rather than quietly widened — a report that
 * silently spanned a different set of shops than the heading claims would be
 * worse than an error.
 *
 * The rebuild is admin-only: it recomputes every snapshot from the source
 * documents, which is a maintenance action, not a report.
 */
router.use( AuthController.checkLogin );

const reports = requirePermission( 'reports' );
const scope = scopeToShops( { 'requireShop': true } );

// Named routes first, so none of them is ever read as an id.
router.get( '/excise-report', reports, scope, StockController.exciseReport );
router.get( '/totals', reports, scope, StockController.totals );
router.get( '/movements', reports, scope, StockController.movements );
router.post( '/rebuild', requireAdmin, StockController.rebuild );
router.get( '/', reports, scope, StockController.report );

module.exports = router;
