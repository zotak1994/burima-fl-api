'use strict';
const SaleController = require( './sale.controller' );
const AuthController = require( '../auth/auth.controller' );
const {
    requireAdmin,
    requirePermission,
    requireAnyPermission,
    scopeToShops
} = require( '../../utils/access' );
const express = require( 'express' );
const router = express.Router();

/**
 * Sales are internal stock records, so every route — reads included —
 * requires a valid JWT.
 *
 * Grants are applied per route rather than to the whole router, because the
 * sales report and the sales summary are Report screens in the admin portal
 * even though they live here: they answer to `reports`, the rest to `sales`.
 *
 * Every route is also held to the outlets assigned to the account. Admins are
 * exempt from both checks. The shop check is attached per route because it
 * needs req.params.id, which a router-level middleware does not see.
 */
router.use( AuthController.checkLogin );

const sales = requirePermission( 'sales' );
const salesOrReports = requireAnyPermission( [ 'sales', 'reports' ] );

/**
 * `ownedOnly` narrows a non-admin to the sales it entered itself, so
 * colleagues working the same shop do not see each other's entries.
 *
 * `draftOnly` makes confirming final for staff: they enter a sale as a draft,
 * correct or delete it freely while it is one, and confirm when it is right —
 * after which they can still read it but not change it.
 */
const scope = scopeToShops( {
    'model': 'sale', 'ownedOnly': true, 'draftOnly': true
} );

/**
 * The report and the summary are shop-wide on purpose. They are reconciliation
 * figures — they have to agree with stock and with the excise return, and a
 * total covering one person's entries would not. Whether staff see them at all
 * is controlled by withholding the `reports` grant, not by filtering them.
 */
const reportScope = scopeToShops( { 'model': 'sale' } );

router.get( '/', sales, scope, SaleController.getAll );
// Named routes before '/:id' so none is ever read as an id.
router.get( '/report', salesOrReports, reportScope, SaleController.report );
router.get( '/summary', salesOrReports, reportScope, SaleController.summary );
router.put( '/:id/confirm', sales, scope, SaleController.confirm );
// Taking a confirmed sale back to draft puts its stock back, so it is a
// correction an administrator makes, not a staff undo. requireAdmin comes
// first, so staff get that answer rather than the generic refusal.
router.put( '/:id/unconfirm', sales, requireAdmin, scope, SaleController.unconfirm );
router.get( '/:id', sales, scope, SaleController.get );
router.post( '/', sales, scope, SaleController.insert );
router.put( '/:id', sales, scope, SaleController.update );
router.delete( '/:id', sales, scope, SaleController.delete );

module.exports = router;
