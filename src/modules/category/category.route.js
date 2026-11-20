'use strict';
const CategoryController = require( './category.controller' );
const AuthController = require( '../auth/auth.controller' );
const express = require( 'express' );
const router = express.Router();

/**
 * Reads are public (the storefront catalogue needs them).
 * Writes require a valid admin JWT (Authorization: Bearer <token>).
 */
router.get( '/', CategoryController.getAll );
router.get( '/:id', CategoryController.get );
router.post( '/', AuthController.checkLogin, CategoryController.insert );
// NOTE: must be declared before '/:id' so 'reorder' isn't captured as an id.
router.put( '/reorder', AuthController.checkLogin, CategoryController.reorder );
router.put( '/:id', AuthController.checkLogin, CategoryController.update );
router.delete( '/:id', AuthController.checkLogin, CategoryController.delete );


module.exports = router;
