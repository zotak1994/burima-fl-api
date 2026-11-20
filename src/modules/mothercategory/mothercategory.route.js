'use strict';
const MotherCategoryController = require( './mothercategory.controller' );
const AuthController = require( '../auth/auth.controller' );
const express = require( 'express' );
const router = express.Router();

/**
 * Reads are public (the storefront catalogue needs them).
 * Writes require a valid admin JWT (Authorization: Bearer <token>).
 */
router.get( '/', MotherCategoryController.getAll );
router.get( '/:id', MotherCategoryController.get );
router.post( '/', AuthController.checkLogin, MotherCategoryController.insert );
// NOTE: must be declared before '/:id' so 'reorder' isn't captured as an id.
router.put( '/reorder', AuthController.checkLogin, MotherCategoryController.reorder );
router.put( '/:id', AuthController.checkLogin, MotherCategoryController.update );
router.delete( '/:id', AuthController.checkLogin, MotherCategoryController.delete );


module.exports = router;
