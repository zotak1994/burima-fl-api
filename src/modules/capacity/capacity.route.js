'use strict';
const CapacityController = require( './capacity.controller' );
const AuthController = require( '../auth/auth.controller' );
const express = require( 'express' );
const router = express.Router();

/**
 * Reads are public (the storefront catalogue needs them).
 * Writes require a valid admin JWT (Authorization: Bearer <token>).
 */
router.get( '/', CapacityController.getAll );
router.get( '/:id', CapacityController.get );
router.post( '/', AuthController.checkLogin, CapacityController.insert );
// NOTE: must be declared before '/:id' so 'reorder' isn't captured as an id.
router.put( '/reorder', AuthController.checkLogin, CapacityController.reorder );
router.put( '/:id', AuthController.checkLogin, CapacityController.update );
router.delete( '/:id', AuthController.checkLogin, CapacityController.delete );


module.exports = router;
