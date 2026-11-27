'use strict';
const PurchaseController = require( './purchase.controller' );
const AuthController = require( '../auth/auth.controller' );
const {
    requireAdmin, requirePermission, scopeToShops
} = require( '../../utils/access' );
const express = require( 'express' );
const router = express.Router();

/**
 * Purchases are internal stock records, so every route — reads included —
 * requires a valid JWT. Nothing here is needed by a storefront.
 *
 * Beyond being signed in, the account needs the `purchases` grant, and every
 * route is held to the outlets assigned to it. Admins are exempt from both.
 */
router.use( AuthController.checkLogin );
router.use( requirePermission( 'purchases' ) );

/**
 * Attached per route rather than with router.use(): the shop check needs
 * req.params.id to read the document's own outlet, and a router-level
 * middleware does not see a route's params.
 *
 * `ownedOnly` narrows a non-admin to the purchases it entered itself, so
 * colleagues working the same shop do not see — or confirm, or delete — each
 * other's paperwork. An admin still sees the whole outlet.
 *
 * `draftOnly` makes confirming final for staff: they enter a purchase as a
 * draft, correct or delete it freely while it is one, and confirm when it is
 * right — after which they can still read it but not change it.
 */
const scope = scopeToShops( {
    'model': 'purchase', 'ownedOnly': true, 'draftOnly': true
} );

router.get( '/', scope, PurchaseController.getAll );
// NOTE: declared before '/:id' so 'confirm' is never read as an id.
router.put( '/:id/confirm', scope, PurchaseController.confirm );
// Taking a confirmed purchase back to draft withdraws stock it already
// posted, so it is a correction an administrator makes, not a staff undo.
// requireAdmin comes first, so staff get that answer rather than the generic
// "confirmed entries cannot be changed".
router.put( '/:id/unconfirm', requireAdmin, scope, PurchaseController.unconfirm );
router.get( '/:id', scope, PurchaseController.get );
router.post( '/', scope, PurchaseController.insert );
router.put( '/:id', scope, PurchaseController.update );
router.delete( '/:id', scope, PurchaseController.delete );


module.exports = router;
