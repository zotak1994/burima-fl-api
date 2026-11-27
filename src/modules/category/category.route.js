'use strict';
const CategoryController = require( './category.controller' );
const AuthController = require( '../auth/auth.controller' );
const { requireAdmin } = require( '../../utils/access' );
const express = require( 'express' );
const router = express.Router();

/**
 * Reads are public (the storefront catalogue needs them).
 * Writes are admin-only: these lookups are shared by every outlet, so a
 * change here changes what all the other shops see.
 */
router.get( '/', CategoryController.getAll );
router.get( '/:id', CategoryController.get );
router.post( '/', AuthController.checkLogin, requireAdmin, CategoryController.insert );
// NOTE: must be declared before '/:id' so 'reorder' isn't captured as an id.
router.put( '/reorder', AuthController.checkLogin, requireAdmin, CategoryController.reorder );
router.put( '/:id', AuthController.checkLogin, requireAdmin, CategoryController.update );
router.delete( '/:id', AuthController.checkLogin, requireAdmin, CategoryController.delete );


module.exports = router;
