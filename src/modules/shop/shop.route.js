'use strict';
const ShopController = require( './shop.controller' );
const AuthController = require( '../auth/auth.controller' );
const { requireAdmin } = require( '../../utils/access' );
const express = require( 'express' );
const router = express.Router();

/**
 * Reads are public, matching the other catalogue lookups (the admin shop
 * switcher needs the list before anything else loads, and it filters the list
 * down to the outlets the signed-in account may work in).
 * Writes are admin-only: shops decide what every other screen shows.
 */
router.get( '/', ShopController.getAll );
router.get( '/:id', ShopController.get );
router.post( '/', AuthController.checkLogin, requireAdmin, ShopController.insert );
// NOTE: must be declared before '/:id' so 'reorder' isn't captured as an id.
router.put( '/reorder', AuthController.checkLogin, requireAdmin, ShopController.reorder );
router.put( '/:id', AuthController.checkLogin, requireAdmin, ShopController.update );
router.delete( '/:id', AuthController.checkLogin, requireAdmin, ShopController.delete );


module.exports = router;
