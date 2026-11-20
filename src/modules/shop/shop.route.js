'use strict';
const ShopController = require( './shop.controller' );
const AuthController = require( '../auth/auth.controller' );
const express = require( 'express' );
const router = express.Router();

/**
 * Reads are public, matching the other catalogue lookups (the admin shop
 * switcher needs the list before anything else loads).
 * Writes require a valid admin JWT (Authorization: Bearer <token>).
 */
router.get( '/', ShopController.getAll );
router.get( '/:id', ShopController.get );
router.post( '/', AuthController.checkLogin, ShopController.insert );
// NOTE: must be declared before '/:id' so 'reorder' isn't captured as an id.
router.put( '/reorder', AuthController.checkLogin, ShopController.reorder );
router.put( '/:id', AuthController.checkLogin, ShopController.update );
router.delete( '/:id', AuthController.checkLogin, ShopController.delete );


module.exports = router;
