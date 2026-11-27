'use strict';
const CapacityController = require( './capacity.controller' );
const AuthController = require( '../auth/auth.controller' );
const { requireAdmin } = require( '../../utils/access' );
const express = require( 'express' );
const router = express.Router();

/**
 * Reads are public (the storefront catalogue needs them).
 * Writes are admin-only: these lookups are shared by every outlet, so a
 * change here changes what all the other shops see.
 */
router.get( '/', CapacityController.getAll );
router.get( '/:id', CapacityController.get );
router.post( '/', AuthController.checkLogin, requireAdmin, CapacityController.insert );
// NOTE: must be declared before '/:id' so 'reorder' isn't captured as an id.
router.put( '/reorder', AuthController.checkLogin, requireAdmin, CapacityController.reorder );
router.put( '/:id', AuthController.checkLogin, requireAdmin, CapacityController.update );
router.delete( '/:id', AuthController.checkLogin, requireAdmin, CapacityController.delete );


module.exports = router;
